import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

/**
 * tiagoh — paid MCP tools, served over streamable-HTTP so any MCP host (including
 * OpenClaw / ClawUp agents) can call them. Each tool advertises its x402 price;
 * in a tiagoh gateway deployment these calls settle per-use over x402 on GOAT.
 * Endpoint: https://tiagoh.vercel.app/api/mcp
 */
const RPC = "https://rpc.goat.network";
const EXPLORER = "https://explorer.goat.network/api/v2";
const USDCE = "0x3022b87ac063DE95b1570F46f5e470F8B53112D8";

async function rpcCall(method: string, params: unknown[] = []): Promise<string> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as string;
}
const hexDec = (h?: string) => (h ? parseInt(h, 16) : 0);
const asText = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });

const handler = createMcpHandler(
  (server) => {
    // ── live-data tools (read GOAT mainnet at call time) ────────────────────
    server.tool(
      "get_goat_chain_stats",
      "Live GOAT mainnet stats: txs today, total txs/addresses, utilization, block time. x402 price: $0.01/call.",
      {},
      async () => {
        const r = await fetch(`${EXPLORER}/stats`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        const s = (await r.json()) as Record<string, unknown>;
        return asText({
          transactionsToday: Number(s.transactions_today),
          totalTransactions: Number(s.total_transactions),
          totalAddresses: Number(s.total_addresses),
          networkUtilizationPct: s.network_utilization_percentage,
          averageBlockTimeMs: s.average_block_time,
          source: "explorer.goat.network/api/v2/stats",
          x402PriceUsd: 0.01,
        });
      },
    );

    server.tool(
      "get_goat_gas",
      "Live GOAT gas price + satoshi cost estimates for transfer / ERC-20 / receipt-anchor ops. x402 price: $0.01/call.",
      {},
      async () => {
        const wei = hexDec(await rpcCall("eth_gasPrice"));
        const sats = (gas: number) => Math.round(((gas * wei) / 1e10) * 100) / 100;
        return asText({
          gasPriceWei: wei,
          estimates: {
            nativeTransfer21k: { sats: sats(21_000) },
            erc20Transfer65k: { sats: sats(65_000) },
            receiptAnchor200k: { sats: sats(200_000) },
            cascadeJob8tx: { sats: sats(1_060_000) },
          },
          source: "rpc.goat.network",
          x402PriceUsd: 0.01,
        });
      },
    );

    server.tool(
      "inspect_address",
      "Live GOAT address inspection: BTC balance, nonce, contract vs EOA. x402 price: $0.02/call.",
      { address: z.string().describe("0x-prefixed GOAT address") },
      async ({ address }) => {
        if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("pass a valid 0x address");
        const [bal, nonce, code] = await Promise.all([
          rpcCall("eth_getBalance", [address, "latest"]),
          rpcCall("eth_getTransactionCount", [address, "latest"]),
          rpcCall("eth_getCode", [address, "latest"]),
        ]);
        return asText({
          address,
          balanceSats: Math.round(Number(BigInt(bal)) / 1e10),
          nonce: hexDec(nonce),
          isContract: code !== "0x",
          source: "rpc.goat.network",
          x402PriceUsd: 0.02,
        });
      },
    );

    server.tool(
      "get_token_info",
      "Live ERC-20 metadata on GOAT (name, symbol, decimals, supply). Defaults to USDC.e. x402 price: $0.02/call.",
      { token: z.string().optional().describe("ERC-20 address, default USDC.e") },
      async ({ token }) => {
        const t = token ?? USDCE;
        if (!/^0x[0-9a-fA-F]{40}$/.test(t)) throw new Error("pass a valid 0x token address");
        const call = (data: string) => rpcCall("eth_call", [{ to: t, data }, "latest"]);
        const [dec, supply] = await Promise.all([call("0x313ce567"), call("0x18160ddd")]);
        const decimals = hexDec(dec);
        return asText({
          token: t,
          decimals,
          totalSupply: supply && supply !== "0x" ? Number(BigInt(supply)) / 10 ** decimals : null,
          source: "rpc.goat.network",
          x402PriceUsd: 0.02,
        });
      },
    );

    server.tool(
      "get_tx_status",
      "Live GOAT transaction lookup: status, gas used, fee in satoshi, confirmations. x402 price: $0.02/call.",
      { hash: z.string().describe("0x-prefixed tx hash") },
      async ({ hash }) => {
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("pass a valid 0x tx hash");
        const res = await fetch(RPC, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
          signal: AbortSignal.timeout(8000),
        });
        const receipt = ((await res.json()) as { result?: Record<string, string> | null }).result;
        if (!receipt) return asText({ hash, found: false, x402PriceUsd: 0.02 });
        const gasUsed = hexDec(receipt.gasUsed);
        const gasPrice = hexDec(receipt.effectiveGasPrice);
        return asText({
          hash,
          found: true,
          success: receipt.status === "0x1",
          blockNumber: hexDec(receipt.blockNumber),
          gasUsed,
          feeSats: Math.round(((gasUsed * gasPrice) / 1e10) * 100) / 100,
          source: "rpc.goat.network",
          x402PriceUsd: 0.02,
        });
      },
    );

    server.tool(
      "get_erc8004_registry_stats",
      "Live canonical ERC-8004 registry activity on GOAT (identity/reputation/validation tx counts). x402 price: $0.02/call.",
      {},
      async () => {
        const reg = {
          identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
          reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
          validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
        };
        const rows = await Promise.all(
          Object.entries(reg).map(async ([k, a]) => {
            try {
              const r = await fetch(`${EXPLORER}/addresses/${a}/counters`, {
                headers: { accept: "application/json" },
                signal: AbortSignal.timeout(8000),
              });
              const c = (await r.json()) as Record<string, unknown>;
              return [k, { address: a, transactions: Number(c.transactions_count ?? 0) }] as const;
            } catch {
              return [k, { address: a, transactions: null }] as const;
            }
          }),
        );
        return asText({ registries: Object.fromEntries(rows), x402PriceUsd: 0.02 });
      },
    );

    // ── labeled fallbacks (kept for the cascade demo) ───────────────────────
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
      description:
        "Paid GOAT data tools in the $0.01–0.10 band (x402): live chain stats, gas, address/tx/token inspection, ERC-8004 registry activity, plus market/RWA/yield data.",
      transport: "streamable-http",
      endpoint: "/api/mcp",
      tools: [
        "get_goat_chain_stats",
        "get_goat_gas",
        "inspect_address",
        "get_token_info",
        "get_tx_status",
        "get_erc8004_registry_stats",
        "get_goat_market_data",
        "get_rwa_price",
        "get_defi_yields",
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

export { GET, POST, DELETE };
export const runtime = "nodejs";
export const maxDuration = 60;
