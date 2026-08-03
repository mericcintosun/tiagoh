import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, BudgetExceededError, listPaidTools, callPaidTool } from "@tiagoh/client";
import {
  TiagohConfigSchema,
  formatMinor,
  parseMinor,
  toMinor,
  type Receipt,
} from "@tiagoh/core";
import { createOnchainSettle } from "@tiagoh/goat";

/**
 * End-to-end x402 flow, fully runnable (local mock facilitator, no chain needed):
 *   agent → paying client → gateway (402 + nonce) → sign → charge-on-success → co-signed receipt
 *
 * Demonstrates: per-call payment, charge-on-success (a failed tool is never billed), replay
 * protection (a spent nonce cannot buy a second execution), idempotent retries, a cascade
 * (analyze_portfolio buys 3 tools downstream, linked to its paymentId), budget enforcement, and
 * receipts that carry both parties' signatures — the only kind that can back a dispute.
 */
const PORT = 4402;
const BASE = `http://localhost:${PORT}`;
const receipts: Receipt[] = [];

async function callUpstream(
  tool: string,
  rawArgs: unknown,
  ctx: { paymentId: string; parentId: string | null },
): Promise<unknown> {
  const args = (rawArgs ?? {}) as { asset?: string };
  switch (tool) {
    case "get_goat_market_data":
      return { btcUsd: 98342.11, goatTvlUsd: 41_200_000 };
    case "get_rwa_price":
      return { asset: args.asset ?? "gold", priceUsd: 4095.83 };
    case "get_defi_yields":
      return { yields: [{ protocol: "stBTC", apy: 6.2 }] };
    case "analyze_portfolio": {
      // CASCADE: a paid tool that buys from other paid tools, linking every
      // downstream receipt to THIS call's paymentId (ctx.paymentId).
      const budget = new BudgetGuard(toMinor("1"));
      const buy = (t: string, a: unknown = {}) =>
        callPaidTool(BASE, t, a, {
          budget,
          sign: signPayment,
          signReceipt: signReceiptFor("analyst"),
          parentId: ctx.paymentId,
          payer: "analyst",
        });
      const [m, r, y] = await Promise.all([
        buy("get_goat_market_data"),
        buy("get_rwa_price", { asset: "gold" }),
        buy("get_defi_yields"),
      ]);
      return {
        recommendation: "55% stBTC · 30% tokenized treasuries · 15% gold",
        grounding: { market: m.result, rwa: r.result, yields: y.result },
      };
    }
    case "flaky_tool":
      throw new Error("upstream tool failed"); // charge-on-success: never billed
    default:
      throw new Error(`unknown tool ${tool}`);
  }
}

const config = TiagohConfigSchema.parse({
  upstream: { command: "in-process" },
  payTo: "0x0000000000000000000000000000000000005e11",
  asset: "0x00000000000000000000000000000000000tUSD",
  assetDecimals: 6,
  port: PORT,
  tools: [
    { name: "get_goat_market_data", priceUsd: 0.01, description: "GOAT/BTC market data" },
    { name: "get_rwa_price", priceUsd: 0.02, description: "tokenized RWA prices" },
    { name: "get_defi_yields", priceUsd: 0.02, description: "DeFi yields on GOAT" },
    { name: "analyze_portfolio", priceUsd: 0.1, description: "composite analysis (cascades)" },
    { name: "flaky_tool", priceUsd: 0.05, description: "always fails (charge-on-success demo)" },
  ],
});

// TIAGOH_ONCHAIN=1 anchors every settled call to the real ReceiptRegistry on GOAT
// (needs PRIVATE_KEY); otherwise a local mock facilitator is used.
const ONCHAIN = process.env.TIAGOH_ONCHAIN === "1";
const RECEIPT_REGISTRY = (process.env.RECEIPT_REGISTRY_ADDRESS ??
  "0x9a41F6d67D9082a37A16bDD971acc1659b89f1AA") as `0x${string}`;
const TOKEN = (process.env.TIAGOH_PAYMENT_TOKEN ??
  "0xb55822243ea12738A50De04B0AeE4f671732FFBb") as `0x${string}`;
const EXPLORER = process.env.TIAGOH_EXPLORER ?? "https://explorer.goat.network/tx/";

const onchainSettle = ONCHAIN
  ? createOnchainSettle({
      privateKey: process.env.PRIVATE_KEY as `0x${string}`,
      receiptRegistry: RECEIPT_REGISTRY,
      token: TOKEN,
    })
  : null;

/**
 * Mock payment authorization. It binds the challenge nonce, so the seller's replay guard has
 * something real to key on even in the demo. Real signing is `EvmPayerWalletAdapter` in
 * `@tiagoh/goat`, which produces an ERC-3009 authorization the facilitator can settle.
 */
const signPayment = async (c: { nonce: string; amount: string }) => `mock-sig:${c.nonce}:${c.amount}`;

/**
 * Mock receipt co-signature. Real signing is `createChallengeReceiptSigner` (EIP-712, bound to
 * the ReceiptRegistry's domain); the shape is identical, so swapping it is one line.
 */
const signReceiptFor = (who: string) => async (c: { receiptId: string }) =>
  `mock-receipt-sig:${who}:${c.receiptId}`;

const gateway = new TiagohGateway({
  config,
  callUpstream,
  // The demo has no facilitator to verify against, so it opts in explicitly rather than the
  // gateway silently serving paid tools to anyone.
  allowUnverifiedPayments: true,
  settle: onchainSettle
    ? (a) =>
        onchainSettle({
          paymentId: a.paymentId,
          tool: a.tool,
          amount: a.amount,
          parentId: a.parentId,
        })
    : async ({ tool }) => ({ txHash: `mock:${tool}`, payee: config.payTo }),
  cosign: async (r) => `mock-receipt-sig:seller:${r.paymentId}`,
  onReceipt: (r) => receipts.push(r),
});

const money = (v: string | bigint) => formatMinor(parseMinor(v), config.assetDecimals);
let failed = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) failed++;
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${msg}`);
};

async function main() {
  const server = gateway.serve(PORT);
  await new Promise((r) => setTimeout(r, 150));

  console.log("── tiagoh · end-to-end x402 flow (local mock facilitator) ──\n");

  const tools = await listPaidTools(BASE);
  console.log("discovered priced tools:");
  for (const t of tools) console.log(`   ${t.name.padEnd(22)} ${money(t._meta?.tiagoh?.amount ?? "0")}`);

  const SESSION = toMinor("0.30");
  const budget = new BudgetGuard(SESSION);
  const sign = signPayment;
  const signReceipt = signReceiptFor("agent");
  console.log(`\nagent session budget: ${money(SESSION)}`);

  console.log("\n[buy] pay per call over 402:");
  for (const name of ["get_goat_market_data", "get_rwa_price"]) {
    const { receipt } = await callPaidTool(BASE, name, {}, { budget, sign, signReceipt, payer: "agent" });
    console.log(
      `   402 → paid ${name} ${money(receipt.amount)} · remaining ${money(budget.remaining)}`,
    );
  }

  console.log("\n[evidence] receipts carry both parties' signatures:");
  const first = receipts[0]!;
  assert(
    Boolean(first.payerSignature && first.payeeSignature),
    "receipt is co-signed (buyer + seller) → can back a dispute",
  );

  console.log("\n[charge-on-success] a failing tool is never billed:");
  const before = budget.remaining;
  try {
    await callPaidTool(BASE, "flaky_tool", {}, { budget, sign, signReceipt, payer: "agent" });
  } catch {
    console.log("   flaky_tool failed upstream → not settled");
  }
  assert(budget.remaining === before, `budget unchanged after failed call (${money(before)})`);

  console.log("\n[replay] a spent challenge cannot buy a second execution:");
  const challengeRes = await fetch(`${BASE}/mcp/tools/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool: "get_defi_yields", payer: "replayer" }),
  });
  const challenge = (await challengeRes.json()) as { nonce: string; receiptId: string };
  const paidOnce = async () =>
    (
      await fetch(`${BASE}/mcp/tools/call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-payment-signature": `mock-sig:${challenge.nonce}`,
          "x-tiagoh-nonce": challenge.nonce,
        },
        body: JSON.stringify({ tool: "get_defi_yields", payer: "replayer" }),
      })
    ).json() as Promise<{ receipt: Receipt }>;
  const settledCountBefore = receipts.length;
  const a = await paidOnce();
  const b = await paidOnce(); // the replay
  assert(
    receipts.length === settledCountBefore + 1,
    "replaying a spent nonce did not execute or bill a second time",
  );
  assert(a.receipt.paymentId === b.receipt.paymentId, "the retry is idempotent (same receipt)");

  console.log("\n[cascade] analyze_portfolio buys 3 tools downstream:");
  const analyze = await callPaidTool(BASE, "analyze_portfolio", {}, { budget, sign, signReceipt, payer: "agent" });
  const rootId = analyze.receipt.paymentId;
  const children = receipts.filter((r) => r.parentId === rootId);
  console.log(`   analyze_portfolio ${money(analyze.receipt.amount)} → ${children.length} downstream hops:`);
  for (const c of children) {
    console.log(`      └─ ${c.tool.padEnd(22)} ${money(c.amount)} parent=${rootId.slice(0, 10)}…`);
  }
  assert(children.length === 3, "cascade linked 3 downstream receipts to the root");

  console.log("\n[budget] an over-budget call is rejected before signing:");
  const tiny = new BudgetGuard(toMinor("0.05"));
  try {
    await callPaidTool(BASE, "analyze_portfolio", {}, { budget: tiny, sign, signReceipt, payer: "agent2" });
    assert(false, "should have rejected the over-budget call");
  } catch (e) {
    const ok = e instanceof BudgetExceededError;
    console.log(
      `   analyze_portfolio ${money(toMinor("0.10"))} > budget ${money(toMinor("0.05"))} → ${ok ? "BudgetExceeded (no payment signed)" : String(e)}`,
    );
    assert(ok, "over-budget call rejected with BudgetExceededError");
  }

  const settled = receipts.reduce((s, r) => s + parseMinor(r.amount), 0n);
  const cosigned = receipts.filter((r) => r.payerSignature && r.payeeSignature).length;
  console.log("\n── summary ──");
  console.log(`   receipts settled: ${receipts.length} · total volume ${money(settled)}`);
  console.log(`   dispute-grade (co-signed): ${cosigned}/${receipts.length}`);
  console.log(`   agent budget spent: ${money(budget.spent)} / ${money(SESSION)}`);
  if (ONCHAIN) {
    console.log("\n   on-chain receipts anchored:");
    for (const r of receipts) console.log(`      ${r.tool.padEnd(22)} ${EXPLORER}${r.txHash}`);
  }
  console.log(failed === 0 ? "\n✓ end-to-end x402 flow works" : `\n✗ ${failed} assertion(s) failed`);

  server.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
