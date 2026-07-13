import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * A paid tool that itself buys from other paid tools — the cascade. When it
 * runs `analyze_portfolio`, it pays for `get_goat_market_data`, `get_rwa_price`,
 * and `get_defi_yields` downstream, forwarding the cascade parent id so every
 * downstream receipt links back to this root. See @tiagoh/client for the paying
 * fetch that propagates `x-tiagoh-parent-id`.
 */
const PRICE_USD = 0.1;

/** Buys the downstream data tools (integration point: wire createPayingFetch + parentId). */
async function buyDownstreamData(_goal: string): Promise<Record<string, unknown>> {
  // TODO: use @tiagoh/client createPayingFetch against the data gateway, passing
  // this call's paymentId as parentId so the cascade tree reconstructs.
  return {
    market: { btcUsd: 98342.11 },
    rwa: { gold: 4095.83 },
    yields: [{ protocol: "stBTC", apy: 6.2 }],
  };
}

export function createServer() {
  const server = new Server({ name: "tiagoh-portfolio-analyst", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "analyze_portfolio",
        description: "Analyze a DeFi/RWA goal; internally buys market, RWA, and yield data (cascade).",
        inputSchema: { type: "object", properties: { goal: { type: "string" } } },
        _meta: { tiagoh: { priceUsd: PRICE_USD } },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const goal = String((req.params.arguments as { goal?: string })?.goal ?? "balanced");
    const data = await buyDownstreamData(goal);
    const analysis = {
      goal,
      recommendation: "keep ~55% stBTC liquid staking, ~30% tokenized treasuries, ~15% gold hedge",
      grounding: data,
    };
    return { content: [{ type: "text", text: JSON.stringify(analysis) }] };
  });

  return server;
}

async function main() {
  await createServer().connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
