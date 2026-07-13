import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, listPaidTools, callPaidTool } from "@tiagoh/client";
import { runBuyer, createBrain, type PricedTool } from "@tiagoh/agent";
import { TiagohConfigSchema } from "@tiagoh/core";

/**
 * The autonomous buyer, driving the LIVE x402 gateway: it discovers the priced
 * tools, decides (by price + reputation) which are worth buying for the goal,
 * pays each per call over x402 under a fixed budget, and synthesizes a
 * recommendation grounded in the data it actually purchased.
 *
 * Reasoning defaults to a clearly-labeled offline simulation; TIAGOH_AGENT_LIVE=1
 * (+ ANTHROPIC_API_KEY) runs the exact same loop with real Claude.
 */
const PORT = 4403;
const BASE = `http://localhost:${PORT}`;

const REPUTATION: Record<string, number> = {
  get_goat_market_data: 0.92,
  get_rwa_price: 0.78,
  get_defi_yields: 0.85,
};

async function callUpstream(tool: string): Promise<unknown> {
  switch (tool) {
    case "get_goat_market_data":
      return { btcUsd: 98342.11, goatTvlUsd: 41_200_000 };
    case "get_rwa_price":
      return { gold: 4095.83, treasuryApy: 4.3 };
    case "get_defi_yields":
      return { yields: [{ protocol: "stBTC", apy: 6.2 }, { protocol: "lending", apy: 4.1 }] };
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
    { name: "get_rwa_price", priceUsd: 0.02, description: "tokenized RWA prices (gold, treasuries)" },
    { name: "get_defi_yields", priceUsd: 0.02, description: "DeFi yields on GOAT" },
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

  console.log("── tiagoh · autonomous buyer over the live x402 gateway ──\n");
  console.log(`reasoning: ${brain.live ? "Claude (live)" : "simulated (offline, clearly labeled)"}`);
  console.log(`goal:      balanced BTC DeFi/RWA allocation on GOAT`);
  console.log(`budget:    $0.20\n`);

  const result = await runBuyer({
    goal: "Build a balanced BTC DeFi/RWA portfolio allocation on GOAT, grounded in live data.",
    budgetUsd: 0.2,
    brain,
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
      console.log(`   💸 bought ${tool} → paid over x402 · remaining $${budget.remainingUsd.toFixed(2)}`);
      return data;
    },
  });

  console.log(`\nbought:  ${result.bought.join(", ") || "(none)"}`);
  if (result.skipped.length) console.log(`skipped: ${result.skipped.join(", ")}`);
  console.log(`spent:   $${(0.2 - budget.remainingUsd).toFixed(2)} / $0.20`);
  console.log(`\nrecommendation:\n   ${result.recommendation}`);

  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
