import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * Flagship paid MCP server. Each tool advertises its x402 price in `_meta.tiagoh`
 * so a tiagoh gateway can price it and an agent can read the price from
 * tools/list. Data is live where available, labeled fallback otherwise.
 */
const TOOLS = [
  {
    name: "get_goat_market_data",
    description: "BTC + GOAT market data (price, volume, TVL).",
    priceUsd: 0.01,
    handler: async () => ({ btcUsd: 98342.11, goatTvlUsd: 41_200_000, source: "labeled-fallback" }),
  },
  {
    name: "get_rwa_price",
    description: "Tokenized real-world-asset price (gold, treasuries).",
    priceUsd: 0.02,
    handler: async (args: { asset?: string }) => ({ asset: args.asset ?? "gold", priceUsd: 4095.83, source: "labeled-fallback" }),
  },
  {
    name: "get_defi_yields",
    description: "DeFi yields across GOAT protocols.",
    priceUsd: 0.02,
    handler: async () => ({ yields: [{ protocol: "stBTC", apy: 6.2 }, { protocol: "lending", apy: 4.1 }], source: "labeled-fallback" }),
  },
] as const;

export function createServer() {
  const server = new Server({ name: "tiagoh-goat-defi-data", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object", properties: {} },
      _meta: { tiagoh: { priceUsd: t.priceUsd } },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
    const result = await tool.handler((req.params.arguments ?? {}) as never);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
