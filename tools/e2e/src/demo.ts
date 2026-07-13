import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, BudgetExceededError, listPaidTools, callPaidTool } from "@tiagoh/client";
import { TiagohConfigSchema, type Receipt } from "@tiagoh/core";

/**
 * End-to-end x402 flow, fully runnable (local mock facilitator, no chain needed):
 *   agent → paying client → gateway (402) → sign → charge-on-success → receipt
 * Demonstrates: per-call payment, charge-on-success (a failed tool is never billed),
 * a cascade (analyze_portfolio buys 3 tools downstream, linked to its paymentId),
 * and budget enforcement (an over-budget call is rejected before signing).
 */
const PORT = 4402;
const BASE = `http://localhost:${PORT}`;
const receipts: Receipt[] = [];

async function callUpstream(
  tool: string,
  args: { asset?: string } | undefined,
  ctx: { paymentId: string; parentId: string | null },
): Promise<unknown> {
  switch (tool) {
    case "get_goat_market_data":
      return { btcUsd: 98342.11, goatTvlUsd: 41_200_000 };
    case "get_rwa_price":
      return { asset: args?.asset ?? "gold", priceUsd: 4095.83 };
    case "get_defi_yields":
      return { yields: [{ protocol: "stBTC", apy: 6.2 }] };
    case "analyze_portfolio": {
      // CASCADE: a paid tool that buys from other paid tools, linking every
      // downstream receipt to THIS call's paymentId (ctx.paymentId).
      const budget = new BudgetGuard(1);
      const sign = async () => "sig:analyst";
      const buy = (t: string, a: unknown = {}) =>
        callPaidTool(BASE, t, a, { budget, sign, parentId: ctx.paymentId, payer: "analyst" });
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
  payTo: "0xSeller",
  asset: "0xtUSD",
  port: PORT,
  tools: [
    { name: "get_goat_market_data", priceUsd: 0.01, description: "GOAT/BTC market data" },
    { name: "get_rwa_price", priceUsd: 0.02, description: "tokenized RWA prices" },
    { name: "get_defi_yields", priceUsd: 0.02, description: "DeFi yields on GOAT" },
    { name: "analyze_portfolio", priceUsd: 0.1, description: "composite analysis (cascades)" },
    { name: "flaky_tool", priceUsd: 0.05, description: "always fails (charge-on-success demo)" },
  ],
});

const gateway = new TiagohGateway({
  config,
  callUpstream,
  // Local mock facilitator (chain-free dev). Real mode → @tiagoh/goat facilitator + ReceiptRegistry.
  settle: async ({ tool }) => ({ txHash: `mock:${tool}`, payee: config.payTo }),
  onReceipt: (r) => receipts.push(r),
});

const money = (n: number) => `$${n.toFixed(2)}`;
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
  for (const t of tools) console.log(`   ${t.name.padEnd(22)} ${money(t._meta?.tiagoh?.priceUsd ?? 0)}`);

  const budget = new BudgetGuard(0.3);
  const sign = async (c: { priceUsd: number }) => `sig:agent:${c.priceUsd}`;
  console.log(`\nagent session budget: ${money(0.3)}`);

  console.log("\n[buy] pay per call over 402:");
  for (const name of ["get_goat_market_data", "get_rwa_price"]) {
    const { receipt } = await callPaidTool(BASE, name, {}, { budget, sign, payer: "agent" });
    console.log(`   402 → paid ${name} ${money(receipt.amountUsd)} · remaining ${money(budget.remainingUsd)}`);
  }

  console.log("\n[charge-on-success] a failing tool is never billed:");
  const before = budget.remainingUsd;
  try {
    await callPaidTool(BASE, "flaky_tool", {}, { budget, sign, payer: "agent" });
  } catch {
    console.log(`   flaky_tool failed upstream → not settled`);
  }
  assert(budget.remainingUsd === before, `budget unchanged after failed call (${money(before)})`);

  console.log("\n[cascade] analyze_portfolio buys 3 tools downstream:");
  const analyze = await callPaidTool(BASE, "analyze_portfolio", {}, { budget, sign, payer: "agent" });
  const rootId = analyze.receipt.paymentId;
  const children = receipts.filter((r) => r.parentId === rootId);
  console.log(`   analyze_portfolio ${money(analyze.receipt.amountUsd)} → ${children.length} downstream hops:`);
  for (const c of children) console.log(`      └─ ${c.tool.padEnd(22)} ${money(c.amountUsd)} parent=${rootId.slice(0, 8)}…`);
  assert(children.length === 3, "cascade linked 3 downstream receipts to the root");

  console.log("\n[budget] an over-budget call is rejected before signing:");
  const tiny = new BudgetGuard(0.05);
  try {
    await callPaidTool(BASE, "analyze_portfolio", {}, { budget: tiny, sign, payer: "agent2" });
    assert(false, "should have rejected the over-budget call");
  } catch (e) {
    const ok = e instanceof BudgetExceededError;
    console.log(`   analyze_portfolio ${money(0.1)} > budget ${money(0.05)} → ${ok ? "BudgetExceeded (no payment signed)" : String(e)}`);
    assert(ok, "over-budget call rejected with BudgetExceededError");
  }

  const settled = receipts.reduce((s, r) => s + r.amountUsd, 0);
  console.log("\n── summary ──");
  console.log(`   receipts settled: ${receipts.length} · total volume ${money(settled)}`);
  console.log(`   agent budget spent: ${money(0.3 - budget.remainingUsd)} / ${money(0.3)}`);
  console.log(failed === 0 ? "\n✓ end-to-end x402 flow works" : `\n✗ ${failed} assertion(s) failed`);

  server.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
