import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * Flagship paid MCP server. Each tool advertises its x402 price in `_meta.tiagoh`
 * so a tiagoh gateway can price it and an agent can read the price from
 * tools/list. Tools marked `live` read GOAT mainnet (RPC + Blockscout) at call
 * time — real data an agent genuinely pays for; the rest are labeled fallbacks.
 */

const RPC = process.env.GOAT_RPC_URL ?? "https://rpc.goat.network";
const EXPLORER = process.env.GOAT_EXPLORER_API ?? "https://explorer.goat.network/api/v2";

async function rpcCall<T = string>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

async function explorer<T>(path: string): Promise<T> {
  const res = await fetch(`${EXPLORER}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
  return (await res.json()) as T;
}

const hexToDec = (h?: string) => (h ? parseInt(h, 16) : 0);
const decodeString = (h?: string): string | null => {
  if (!h || h === "0x") return null;
  try {
    const off = parseInt(h.slice(2, 66), 16);
    const len = parseInt(h.slice(2 + off * 2, 2 + off * 2 + 64), 16);
    return Buffer.from(h.slice(2 + off * 2 + 64, 2 + off * 2 + 64 + len * 2), "hex").toString();
  } catch {
    return null;
  }
};

interface ToolDef {
  name: string;
  description: string;
  priceUsd: number;
  live: boolean;
  inputSchema?: Record<string, unknown>;
  handler: (args: Record<string, never> & Record<string, unknown>) => Promise<unknown>;
}

const TOOLS: ToolDef[] = [
  // ── live chain data ─────────────────────────────────────────────────────
  {
    name: "get_goat_chain_stats",
    description: "Live GOAT mainnet stats: transactions today, total txs/addresses, utilization, avg block time.",
    priceUsd: 0.01,
    live: true,
    handler: async () => {
      const s = await explorer<Record<string, unknown>>("/stats");
      return {
        transactionsToday: Number(s.transactions_today),
        totalTransactions: Number(s.total_transactions),
        totalAddresses: Number(s.total_addresses),
        networkUtilizationPct: s.network_utilization_percentage,
        averageBlockTimeMs: s.average_block_time,
        gasUsedToday: Number(s.gas_used_today),
        source: "explorer.goat.network/api/v2/stats",
      };
    },
  },
  {
    name: "get_goat_gas",
    description: "Live GOAT gas price plus cost estimates (in satoshi) for transfer / ERC-20 / receipt-anchor operations.",
    priceUsd: 0.01,
    live: true,
    handler: async () => {
      const wei = hexToDec(await rpcCall("eth_gasPrice"));
      const sats = (gas: number) => Math.round(((gas * wei) / 1e10) * 100) / 100;
      return {
        gasPriceWei: wei,
        gasPriceGwei: wei / 1e9,
        estimates: {
          nativeTransfer21k: { sats: sats(21_000) },
          erc20Transfer65k: { sats: sats(65_000) },
          receiptAnchor200k: { sats: sats(200_000) },
          cascadeJob8tx: { sats: sats(1_060_000) },
        },
        source: "rpc.goat.network eth_gasPrice",
      };
    },
  },
  {
    name: "inspect_address",
    description: "Live inspection of any GOAT address: BTC balance, nonce, contract or EOA, bytecode size.",
    priceUsd: 0.02,
    live: true,
    inputSchema: { address: { type: "string", description: "0x-prefixed GOAT address" } },
    handler: async (args) => {
      const address = String(args.address ?? "");
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("pass a valid 0x address");
      const [bal, nonce, code] = await Promise.all([
        rpcCall("eth_getBalance", [address, "latest"]),
        rpcCall("eth_getTransactionCount", [address, "latest"]),
        rpcCall("eth_getCode", [address, "latest"]),
      ]);
      return {
        address,
        balanceBtc: Number(BigInt(bal)) / 1e18,
        balanceSats: Math.round(Number(BigInt(bal)) / 1e10),
        nonce: hexToDec(nonce),
        isContract: code !== "0x",
        bytecodeBytes: (code.length - 2) / 2,
        source: "rpc.goat.network",
      };
    },
  },
  {
    name: "get_token_info",
    description: "Live ERC-20 metadata on GOAT: name, symbol, decimals, total supply. Defaults to USDC.e.",
    priceUsd: 0.02,
    live: true,
    inputSchema: { token: { type: "string", description: "ERC-20 address (default: USDC.e)" } },
    handler: async (args) => {
      const token = String(args.token ?? "0x3022b87ac063DE95b1570F46f5e470F8B53112D8");
      if (!/^0x[0-9a-fA-F]{40}$/.test(token)) throw new Error("pass a valid 0x token address");
      const call = (data: string) => rpcCall<string>("eth_call", [{ to: token, data }, "latest"]);
      const [name, symbol, dec, supply] = await Promise.all([
        call("0x06fdde03"),
        call("0x95d89b41"),
        call("0x313ce567"),
        call("0x18160ddd"),
      ]);
      const decimals = hexToDec(dec);
      return {
        token,
        name: decodeString(name),
        symbol: decodeString(symbol),
        decimals,
        totalSupply: supply && supply !== "0x" ? Number(BigInt(supply)) / 10 ** decimals : null,
        source: "rpc.goat.network eth_call",
      };
    },
  },
  {
    name: "get_tx_status",
    description: "Live transaction lookup on GOAT: status, gas used, fee paid in satoshi, block and confirmations.",
    priceUsd: 0.02,
    live: true,
    inputSchema: { hash: { type: "string", description: "0x-prefixed transaction hash" } },
    handler: async (args) => {
      const hash = String(args.hash ?? "");
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("pass a valid 0x tx hash");
      const [receipt, head] = await Promise.all([
        rpcCall<Record<string, string> | null>("eth_getTransactionReceipt", [hash]),
        rpcCall("eth_blockNumber"),
      ]);
      if (!receipt) return { hash, found: false };
      const gasUsed = hexToDec(receipt.gasUsed);
      const gasPrice = hexToDec(receipt.effectiveGasPrice);
      return {
        hash,
        found: true,
        success: receipt.status === "0x1",
        blockNumber: hexToDec(receipt.blockNumber),
        confirmations: hexToDec(head) - hexToDec(receipt.blockNumber),
        gasUsed,
        feeSats: Math.round(((gasUsed * gasPrice) / 1e10) * 100) / 100,
        to: receipt.to,
        source: "rpc.goat.network",
      };
    },
  },
  {
    name: "get_erc8004_registry_stats",
    description: "Live canonical ERC-8004 registry activity on GOAT: identity/reputation/validation tx counts.",
    priceUsd: 0.02,
    live: true,
    handler: async () => {
      const reg = {
        identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
        validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
      };
      const counters = await Promise.all(
        Object.entries(reg).map(async ([k, a]) => {
          try {
            const c = await explorer<Record<string, unknown>>(`/addresses/${a}/counters`);
            return [k, { address: a, transactions: Number(c.transactions_count ?? 0) }] as const;
          } catch {
            return [k, { address: a, transactions: null }] as const;
          }
        }),
      );
      return { registries: Object.fromEntries(counters), source: "explorer.goat.network address counters" };
    },
  },
  // ── labeled fallbacks (kept for the cascade demo) ───────────────────────
  {
    name: "get_goat_market_data",
    description: "BTC + GOAT market data (price, volume, TVL).",
    priceUsd: 0.01,
    live: false,
    handler: async () => ({ btcUsd: 98342.11, goatTvlUsd: 353_000, source: "labeled-fallback" }),
  },
  {
    name: "get_rwa_price",
    description: "Tokenized real-world-asset price (gold, treasuries).",
    priceUsd: 0.02,
    live: false,
    handler: async (args) => ({ asset: (args.asset as string) ?? "gold", priceUsd: 4095.83, source: "labeled-fallback" }),
  },
  {
    name: "get_defi_yields",
    description: "DeFi yields across GOAT protocols.",
    priceUsd: 0.02,
    live: false,
    handler: async () => ({
      yields: [
        { protocol: "stBTC", apy: 6.2 },
        { protocol: "lending", apy: 4.1 },
      ],
      source: "labeled-fallback",
    }),
  },
];

export function createServer() {
  const server = new Server({ name: "tiagoh-goat-defi-data", version: "0.2.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object", properties: t.inputSchema ?? {} },
      _meta: { tiagoh: { priceUsd: t.priceUsd, live: t.live } },
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
