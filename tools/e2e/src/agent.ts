import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, listPaidTools, callPaidTool } from "@tiagoh/client";
import { runBuyer, createBrain, createVerifier, type PricedTool } from "@tiagoh/agent";
import { readScore } from "@tiagoh/goat";
import { TiagohConfigSchema } from "@tiagoh/core";

/**
 * The autonomous buyer over the LIVE x402 gateway, now with judgement:
 *   discover → read on-chain reputation → decide → pay per call under budget →
 *   VERIFY each output → DISPUTE the bad ones (refund + slash) → synthesize.
 * No gas: gateway settle + dispute are local callbacks; the reputation read is a
 * free on-chain view; the on-chain dispute path is built (see @tiagoh/goat).
 */
const PORT = 4403;
const BASE = `http://localhost:${PORT}`;
const SCORER = "0x10d7eC7fEbCB3009e2842B35616eA1609249C695" as const; // ReputationScorer (GOAT testnet)
const SUBJECT = "0x000000000000000000000000000000000000d002" as const;

const REPUTATION: Record<string, number> = {
  get_goat_market_data: 0.92,
  get_rwa_price: 0.78,
  get_defi_yields: 0.85,
  flaky_data: 0.4,
};

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

const config = TiagohConfigSchema.parse({
  upstream: { command: "in-process" },
  payTo: "0xSeller",
  asset: "0xtUSD",
  port: PORT,
  tools: [
    { name: "get_goat_market_data", priceUsd: 0.01, description: "GOAT/BTC market data" },
    { name: "get_rwa_price", priceUsd: 0.02, description: "tokenized RWA prices" },
    { name: "get_defi_yields", priceUsd: 0.02, description: "DeFi yields on GOAT" },
    { name: "flaky_data", priceUsd: 0.03, description: "unreliable data source" },
  ],
});

const gateway = new TiagohGateway({
  config,
  callUpstream: (t) => callUpstream(t),
  settle: async ({ tool }) => ({ txHash: `mock:${tool}`, payee: config.payTo }),
});

async function main() {
  const server = gateway.serve(PORT);
  await new Promise((r) => setTimeout(r, 150));

  const budget = new BudgetGuard(0.2);
  const sign = async () => "sig:agent";
  const brain = createBrain();

  console.log("── tiagoh · autonomous buyer (reputation-aware, self-verifying) ──\n");
  console.log(`reasoning: ${brain.live ? "Claude (live)" : "simulated (offline, clearly labeled)"}`);

  // Live on-chain reputation read (free view call).
  const onchain = await readScore(SCORER, SUBJECT).catch(() => -1n);
  console.log(
    `on-chain reputation: ReputationScorer.scoreOf(${SUBJECT.slice(0, 8)}…) = ${onchain >= 0n ? onchain.toString() : "unavailable"} (live read)`,
  );
  console.log(`goal:   balanced BTC DeFi/RWA allocation on GOAT · budget $0.20\n`);

  const result = await runBuyer({
    goal: "Build a balanced BTC DeFi/RWA portfolio allocation on GOAT, grounded in live data.",
    budgetUsd: 0.2,
    brain,
    verify: createVerifier(),
    discover: async () => {
      const tools = await listPaidTools(BASE);
      return tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        priceUsd: t._meta?.tiagoh?.priceUsd ?? 0,
        reputation: REPUTATION[t.name] ?? 0.5,
      })) as PricedTool[];
    },
    buy: async (tool) => {
      const { result: data } = await callPaidTool(BASE, tool, {}, { budget, sign, payer: "agent" });
      console.log(`   💸 paid ${tool} over x402 · remaining $${budget.remainingUsd.toFixed(2)}`);
      return data;
    },
    dispute: async ({ tool, reason }) => {
      const price = config.tools.find((t) => t.name === tool)?.priceUsd ?? 0;
      budget.refund(price); // disputed → refunded
      console.log(
        `   ⚖️  disputed ${tool}: ${reason} → escrow refund + bond slash (on-chain path ready; skipped to save gas)`,
      );
    },
  });

  console.log(`\nbought:    ${result.bought.join(", ") || "(none)"}`);
  console.log(`disputed:  ${result.disputed.join(", ") || "(none)"}`);
  console.log(`spent:     $${(0.2 - budget.remainingUsd).toFixed(2)} / $0.20 (disputed calls refunded)`);
  console.log(`\nrecommendation (grounded only in verified data):\n   ${result.recommendation}`);

  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
