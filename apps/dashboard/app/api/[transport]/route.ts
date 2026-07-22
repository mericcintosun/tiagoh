import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

/**
 * tiagoh — paid MCP tools, served over streamable-HTTP so any MCP host (including
 * OpenClaw / ClawUp agents) can call them. Each tool advertises its x402 price;
 * in a tiagoh gateway deployment these calls settle per-use over x402 on GOAT.
 * Endpoint: https://tiagoh.vercel.app/api/mcp
 */
const handler = createMcpHandler(
  (server) => {
    server.tool(
      "get_goat_market_data",
      "BTC + GOAT market data (price, volume, TVL). x402 price: $0.01/call.",
      {},
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              btcUsd: 98342.11,
              goatTvlUsd: 41_200_000,
              source: "tiagoh:goat-defi-data",
              x402PriceUsd: 0.01,
              network: "goat:2345",
            }),
          },
        ],
      }),
    );

    server.tool(
      "get_rwa_price",
      "Tokenized real-world-asset price (gold, treasuries, etc.). x402 price: $0.02/call.",
      { asset: z.string().optional().describe("asset symbol, e.g. gold or treasury") },
      async ({ asset }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              asset: asset ?? "gold",
              priceUsd: 4095.83,
              source: "tiagoh:goat-defi-data",
              x402PriceUsd: 0.02,
            }),
          },
        ],
      }),
    );

    server.tool(
      "get_defi_yields",
      "DeFi yields across GOAT protocols. x402 price: $0.02/call.",
      {},
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              yields: [
                { protocol: "stBTC", apy: 6.2 },
                { protocol: "lending", apy: 4.1 },
              ],
              source: "tiagoh:goat-defi-data",
              x402PriceUsd: 0.02,
            }),
          },
        ],
      }),
    );
  },
  {},
  { basePath: "/api", maxDuration: 60, verboseLogs: false },
);

/**
 * Compatibility wrapper: some MCP clients/registries (e.g. ClawUp's validator)
 * send only `Accept: application/json`, which the streamable-HTTP transport
 * rejects with 406. We normalize the Accept header so any client works, and
 * answer a plain GET with a friendly descriptor instead of 405.
 */
async function normalize(req: Request): Promise<Request> {
  const headers = new Headers(req.headers);
  const accept = headers.get("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    headers.set("accept", "application/json, text/event-stream");
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;
  return new Request(req.url, { method: req.method, headers, body });
}

const POST = async (req: Request) => handler(await normalize(req));
const DELETE = POST;

const GET = () =>
  new Response(
    JSON.stringify({
      name: "tiagoh",
      description: "Paid GOAT/BTC market data, RWA prices & DeFi yields (x402).",
      transport: "streamable-http",
      endpoint: "/api/mcp",
      tools: ["get_goat_market_data", "get_rwa_price", "get_defi_yields"],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

export { GET, POST, DELETE };
export const runtime = "nodejs";
export const maxDuration = 60;
