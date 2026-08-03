import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, listPaidTools, callPaidTool } from "@tiagoh/client";
import { runBuyer, createBrain, createVerifier, type PricedTool } from "@tiagoh/agent";
import { readToolScore, createOnchainDispute } from "@tiagoh/goat";
import { TiagohConfigSchema, formatMinor, parseMinor, toMinor } from "@tiagoh/core";

/**
 * The autonomous buyer over the LIVE x402 gateway, with judgement AND recourse:
 *   discover → read on-chain reputation → decide → pay per call under budget →
 *   VERIFY each output → DISPUTE the bad ones against a co-signed receipt → synthesize.
 *
 * The dispute is the part that used to be decorative. A dispute needs provable harm, and on the
 * instant-settle path that proof is a receipt carrying BOTH parties' signatures — so the client
 * pre-signs each receipt and the gateway counter-signs it. Only then does `openDispute` have
 * something an arbiter can act on. Set TIAGOH_ONCHAIN_DISPUTE=1 (plus PRIVATE_KEY and
 * DISPUTE_ARBITER_ADDRESS) to send it for real; otherwise it is reported rather than sent, so
 * the demo stays gas-free without pretending recourse happened.
 */
const PORT = 4403;
const BASE = `http://localhost:${PORT}`;

/**
 * ReputationScorer on GOAT mainnet (contracts/deployments/goat-mainnet.json). The address and
 * the default chain now agree; they used to not — the demo read a Testnet3 address over what the
 * rest of the app treated as mainnet, so the "live reputation read" quietly reported
 * "unavailable" instead of failing.
 */
const SCORER = (process.env.REPUTATION_SCORER_ADDRESS ??
  "0x3823eCd18FFEE1e8dD3F40467B0b64970bD95f5a") as `0x${string}`;

const config = TiagohConfigSchema.parse({
  upstream: { command: "in-process" },
  payTo: "0x0000000000000000000000000000000000005e11",
  asset: "0x00000000000000000000000000000000000tUSD",
  assetDecimals: 6,
  chainId: 2345,
  port: PORT,
  tools: [
    { name: "get_goat_market_data", priceUsd: 0.01, description: "GOAT/BTC market data" },
    { name: "get_rwa_price", priceUsd: 0.02, description: "tokenized RWA prices" },
    { name: "get_defi_yields", priceUsd: 0.02, description: "DeFi yields on GOAT" },
    { name: "flaky_data", priceUsd: 0.03, description: "unreliable data source" },
  ],
});

async function callUpstream(tool: string): Promise<unknown> {
  switch (tool) {
    case "get_goat_market_data":
      return { btcUsd: 98342.11, goatTvlUsd: 41_200_000 };
    case "get_rwa_price":
      return { priceUsd: 4095.83, asset: "gold" };
    case "get_defi_yields":
      return { yields: [{ protocol: "stBTC", apy: 6.2 }, { protocol: "lending", apy: 4.1 }] };
    case "flaky_data":
      return { error: "upstream data source unavailable" }; // bad output → verifier flags it
    default:
      throw new Error(`unknown tool ${tool}`);
  }
}

const gateway = new TiagohGateway({
  config,
  callUpstream: (t) => callUpstream(t),
  allowUnverifiedPayments: true, // local demo: no facilitator to verify against
  settle: async ({ tool }) => ({ txHash: `mock:${tool}`, payee: config.payTo }),
  cosign: async (r) => `mock-receipt-sig:seller:${r.paymentId}`,
});

const money = (v: string | bigint) => formatMinor(parseMinor(v), config.assetDecimals);

/**
 * Bond-capped on-chain reputation for a tool, normalized to 0..1 for the buyer's heuristic. A
 * tool with no live bond scores zero however much volume it has fabricated, so an unknown Sybil
 * cannot present itself as reputable. An unreachable chain yields `undefined` — the buyer then
 * treats the tool as unknown rather than silently assuming it is fine.
 */
async function reputationOf(tool: string): Promise<number | undefined> {
  try {
    const score = Number(await readToolScore(SCORER, tool));
    return score / (score + 100); // diminishing returns, bounded to [0,1)
  } catch {
    return undefined;
  }
}

async function main() {
  const server = gateway.serve(PORT);
  await new Promise((r) => setTimeout(r, 150));

  const SESSION = toMinor("0.20");
  const budget = new BudgetGuard(SESSION);
  const brain = createBrain();
  const sign = async (c: { nonce: string }) => `mock-sig:${c.nonce}`;
  const signReceipt = async (c: { receiptId: string }) => `mock-receipt-sig:agent:${c.receiptId}`;

  console.log("── tiagoh · autonomous buyer (reputation-aware, self-verifying) ──\n");
  console.log(`reasoning: ${brain.live ? "Claude (live)" : "simulated (offline, clearly labeled)"}`);

  const onchainDispute =
    process.env.TIAGOH_ONCHAIN_DISPUTE === "1" &&
    process.env.PRIVATE_KEY &&
    process.env.DISPUTE_ARBITER_ADDRESS
      ? createOnchainDispute({
          privateKey: process.env.PRIVATE_KEY as `0x${string}`,
          arbiter: process.env.DISPUTE_ARBITER_ADDRESS as `0x${string}`,
        })
      : null;
  console.log(
    `recourse:  ${onchainDispute ? "on-chain disputes ENABLED" : "reported only (TIAGOH_ONCHAIN_DISPUTE=1 to send)"}`,
  );
  console.log(`scorer:    ${SCORER} (bond-capped, chainId ${config.chainId})`);
  console.log(`goal:      balanced BTC DeFi/RWA allocation on GOAT · budget ${money(SESSION)}\n`);

  const result = await runBuyer({
    goal: "Build a balanced BTC DeFi/RWA portfolio allocation on GOAT, grounded in live data.",
    budget: SESSION,
    brain,
    verify: createVerifier(),
    discover: async () => {
      const tools = await listPaidTools(BASE);
      const priced = await Promise.all(
        tools.map(async (t) => ({
          name: t.name,
          description: t.description ?? "",
          amount: parseMinor(t._meta?.tiagoh?.amount ?? "0"),
          reputation: await reputationOf(t.name),
        })),
      );
      for (const t of priced) {
        const rep = t.reputation === undefined ? "unknown" : t.reputation.toFixed(2);
        console.log(`   ${t.name.padEnd(22)} ${money(t.amount)}  rep=${rep}`);
      }
      return priced as PricedTool[];
    },
    buy: async (tool) => {
      const { result: output, receipt } = await callPaidTool(
        BASE,
        tool,
        {},
        { budget, sign, signReceipt, payer: "0x0000000000000000000000000000000000000b0b" },
      );
      console.log(`   paid ${tool.padEnd(22)} ${money(receipt.amount)}`);
      return { tool, output, receipt };
    },
    dispute: async ({ tool, receipt, reason }) => {
      console.log(`   ⚠ disputed ${tool}: ${reason}`);
      console.log(`     evidence: co-signed receipt ${receipt.paymentId.slice(0, 18)}…`);
      if (!onchainDispute) return;
      // Ask to slash up to the harm the receipt proves; the arbiter caps it again on-chain at
      // min(provenHarm, liveBond), so this can never over-reach.
      const { txHash } = await onchainDispute({
        receiptId: receipt.paymentId,
        slashAmount: parseMinor(receipt.amount),
      });
      console.log(`     openDispute tx ${txHash}`);
    },
  });

  console.log("\n── outcome ──");
  console.log(`   bought:     ${result.bought.join(", ") || "none"}`);
  console.log(`   disputed:   ${result.disputed.join(", ") || "none"}`);
  if (result.unprovable.length) {
    console.log(
      `   unprovable: ${result.unprovable.join(", ")} (receipt not co-signed → no recourse)`,
    );
  }
  console.log(`   skipped:    ${result.skipped.join(", ") || "none"}`);
  console.log(`   spent:      ${money(budget.spent)} / ${money(SESSION)} (disputed calls credited back)`);
  console.log(`\nrecommendation (grounded only in verified data):\n   ${result.recommendation}`);

  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
