import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { keccak256, toHex } from "viem";
import { checkChallenge, encodeChallenge, issueChallenge } from "@/lib/x402-paywall";
import { settleBare, verifyPayment } from "@/lib/x402-settle";

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

// ── the paywall ──────────────────────────────────────────────────────────────

/**
 * Per-request payment context.
 *
 * MCP tool callbacks receive only their arguments, but x402 puts the payment in a header, so the
 * transport wrapper stashes it here for the duration of the request. `AsyncLocalStorage` rather
 * than a module variable, because concurrent requests on one instance would otherwise read each
 * other's payment.
 */
const requestCtx = new AsyncLocalStorage<{ payment?: string; challenge?: string; payer?: string }>();

const SETTLER = process.env.X402_SETTLER_ADDRESS ?? "";
const SELLER_PAYTO = process.env.TIAGOH_PAY_TO ?? "";
const CHALLENGE_SECRET = process.env.TIAGOH_CHALLENGE_SECRET ?? "";
const SUBMITTER_KEY = process.env.TIAGOH_SUBMITTER_KEY ?? "";
const RECEIPT_REGISTRY = process.env.RECEIPT_REGISTRY_ADDRESS ?? "";
const CHAIN_ID = Number(process.env.GOAT_CHAIN_ID ?? 2345);

/**
 * Charging is off unless the deployment is fully configured to settle. A half-configured paywall
 * that takes an authorization it cannot settle is worse than a free endpoint: the caller believes
 * they paid.
 */
const PAID_MODE = Boolean(
  SETTLER && SELLER_PAYTO && CHALLENGE_SECRET && SUBMITTER_KEY && RECEIPT_REGISTRY,
);

/** Free tier: the two cheapest chain reads stay free forever, as the hook. */
const FREE_TOOLS = new Set(["get_goat_chain_stats", "get_goat_gas"]);

const PRICES_USD: Record<string, number> = {
  inspect_address: 0.02,
  get_token_info: 0.02,
  get_tx_status: 0.02,
  get_erc8004_registry_stats: 0.02,
  get_goat_market_data: 0.02,
};

const minorUnits = (usd: number) => String(Math.round(usd * 1e6));

/**
 * Payment carried as tool *arguments*, not just headers.
 *
 * x402 puts the payment in `X-PAYMENT`, which is correct for HTTP clients — but plenty of MCP
 * hosts give an agent no way to set a custom header (ClawUp is one), and for them a header-only
 * paywall is an unpayable one. The same three values as tool arguments make every paid tool
 * reachable from any MCP client, with no protocol extension and no loss of security: the payload
 * is identical, and the challenge is still HMAC-signed and still verified against the chain.
 *
 * Headers win when both are present, since a host that can set them is the more deliberate path.
 */
const PAYMENT_ARGS = {
  _payer: z
    .string()
    .optional()
    .describe("Your GOAT address. Send this alone first to receive a price quote and challenge."),
  _challenge: z
    .string()
    .optional()
    .describe("The `challenge` string returned by the quote, echoed back verbatim."),
  _payment: z
    .string()
    .optional()
    .describe(
      "Base64 x402 v2 `exact` payload: an ERC-3009 TransferWithAuthorization signed for `amount` " +
        "to `settleTo`, using the challenge nonce as the authorization nonce.",
    ),
} as const;

/** Payment fields an MCP client may pass as arguments. */
interface PaymentArgs {
  _payer?: string;
  _challenge?: string;
  _payment?: string;
}

/**
 * Gate a tool behind x402.
 *
 * MCP has no HTTP 402: the transport wraps everything in JSON-RPC, and returning a 402 status
 * would break the client's parser rather than tell it the price. So an unpaid call succeeds at
 * the protocol level and returns the challenge *as its result* — an agent reads `paymentRequired`,
 * signs the authorization, and calls again with the headers. Same information, delivered in a
 * shape MCP clients already handle.
 */
function withPayment<A>(
  tool: string,
  run: (args: A) => Promise<ReturnType<typeof asText>>,
): (args: A) => Promise<ReturnType<typeof asText>> {
  return async (args: A) => {
    const priceUsd = PRICES_USD[tool];
    if (!PAID_MODE || priceUsd === undefined || FREE_TOOLS.has(tool)) return run(args);

    const ctx = requestCtx.getStore();
    const fromArgs = (args ?? {}) as PaymentArgs;
    const amount = minorUnits(priceUsd);
    const payer = ctx?.payer ?? fromArgs._payer ?? "";
    const payment = ctx?.payment ?? fromArgs._payment;
    const challengeIn = ctx?.challenge ?? fromArgs._challenge;

    const challengeFor = (reason?: string) =>
      asText({
        paymentRequired: true,
        ...(reason ? { reason } : {}),
        x402Version: 2,
        challenge: encodeChallenge(
          issueChallenge(
            {
              tool,
              amount,
              asset: USDCE,
              assetDecimals: 6,
              network: `eip155:${CHAIN_ID}`,
              payTo: SELLER_PAYTO,
              settleTo: SETTLER,
              payer,
              parentId: null,
            },
            CHALLENGE_SECRET,
          ),
        ),
        howToPay:
          "Decode `challenge` (base64 JSON). Sign an ERC-3009 TransferWithAuthorization for its " +
          "`amount` to its `settleTo`, using its `nonce` as the authorization nonce and " +
          "`expiresAt`/1000 as validBefore. Call this tool again with _payer, _challenge (verbatim) " +
          "and _payment (base64 x402 payload). Headers X-PAYMENT / X-TIAGOH-CHALLENGE work too. " +
          "You pay no gas — the seller relays it. See https://tiagoh.vercel.app/pricing",
      });

    if (!payer) return challengeFor("call again with `_payer` set to your GOAT address for a quote");
    if (!payment || !challengeIn) return challengeFor();

    const checked = checkChallenge(challengeIn, { tool, amount, payer }, CHALLENGE_SECRET);
    if (!checked.ok) return challengeFor(checked.reason);

    // Verify against the chain before doing any work. This is also what closes replay without a
    // shared store: a spent authorization fails here, because the token records its own nonces.
    const result = await verifyPayment(payment, {
      token: USDCE as `0x${string}`,
      amount,
      nonce: checked.challenge.nonce,
      payer,
      settleTo: SETTLER,
    });
    if (!result.ok) return challengeFor(result.reason);

    // Charge-on-success: run first, settle only if it worked.
    const out = await run(args);

    // The receipt id is the challenge nonce: unique per call, and already covered by the
    // gateway's HMAC, so it needs no separate derivation.
    await settleBare({
      submitterKey: SUBMITTER_KEY as `0x${string}`,
      settler: SETTLER as `0x${string}`,
      header: payment,
      receiptId: checked.challenge.nonce as `0x${string}`,
      toolId: keccak256(toHex(tool)),
      payee: SELLER_PAYTO as `0x${string}`,
    });
    return out;
  };
}

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
      { address: z.string().describe("0x-prefixed GOAT address") , ...PAYMENT_ARGS },
      withPayment("inspect_address", async ({ address }) => {
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
      }),
    );

    server.tool(
      "get_token_info",
      "Live ERC-20 metadata on GOAT (name, symbol, decimals, supply). Defaults to USDC.e. x402 price: $0.02/call.",
      { token: z.string().optional().describe("ERC-20 address, default USDC.e") , ...PAYMENT_ARGS },
      withPayment("get_token_info", async ({ token }) => {
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
      }),
    );

    server.tool(
      "get_tx_status",
      "Live GOAT transaction lookup: status, gas used, fee in satoshi, confirmations. x402 price: $0.02/call.",
      { hash: z.string().describe("0x-prefixed tx hash") , ...PAYMENT_ARGS },
      withPayment("get_tx_status", async ({ hash }) => {
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
      }),
    );

    server.tool(
      "get_erc8004_registry_stats",
      "Live canonical ERC-8004 registry activity on GOAT (identity/reputation/validation tx counts). x402 price: $0.02/call.",
      { ...PAYMENT_ARGS },
      withPayment("get_erc8004_registry_stats", async () => {
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
      }),
    );

    /*
     * Three tools used to live here — `get_goat_market_data`, `get_rwa_price` and
     * `get_defi_yields` — and all three returned hardcoded numbers (`btcUsd: 98342.11`,
     * `priceUsd: 4095.83`, a fixed yield table). Harmless while the endpoint was free; the
     * moment it is paywalled, selling fabricated data is exactly the behaviour the bond and
     * dispute layer exists to punish, and we would be its first offender.
     *
     * `get_goat_market_data` is now real (below). The other two are gone rather than faked:
     * DefiLlama lists **zero** yield pools on GOAT, and there is no free, honest feed for
     * tokenized RWA prices. A tool with no source is not a tool.
     */
    server.tool(
      "get_goat_market_data",
      "Live BTC + GOATED price and GOAT chain TVL, from CoinGecko and DefiLlama. x402 price: $0.02/call.",
      { ...PAYMENT_ARGS },
      withPayment("get_goat_market_data", async () => {
        const [prices, chains] = await Promise.all([
          fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,goat-network&vs_currencies=usd&include_24hr_change=true",
            { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
          ).then((r) => r.json() as Promise<Record<string, Record<string, number>>>),
          fetch("https://api.llama.fi/v2/chains", {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(8000),
          }).then((r) => r.json() as Promise<Array<Record<string, unknown>>>),
        ]);
        const goat = chains.find((c) => c.chainId === 2345);
        return asText({
          btc: { usd: prices.bitcoin?.usd ?? null, change24hPct: prices.bitcoin?.usd_24h_change ?? null },
          goated: {
            usd: prices["goat-network"]?.usd ?? null,
            change24hPct: prices["goat-network"]?.usd_24h_change ?? null,
          },
          goatChainTvlUsd: (goat?.tvl as number | undefined) ?? null,
          sources: ["api.coingecko.com", "api.llama.fi"],
          x402PriceUsd: 0.02,
        });
      }),
    );
  },
  {
    // What every MCP client and the ClawUp marketplace shows. The default from `mcp-handler`
    // is "mcp-typescript server on vercel", which tells a user nothing about whose tools these
    // are or what they cost.
    serverInfo: { name: "tiagoh", version: "0.2.0" },
    instructions:
      "Paid GOAT Network data tools, settled per call in USDC.e over x402. `get_goat_chain_stats` " +
      "and `get_goat_gas` are free; the rest cost $0.02 and answer an unpaid call with a signed " +
      "payment challenge instead of data. See https://tiagoh.vercel.app/pricing.",
  },
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

/**
 * Read the payment headers once, at the transport edge, and make them available to whichever
 * tool the JSON-RPC body ends up dispatching to.
 */
const POST = async (req: Request) => {
  const normalized = await normalize(req);
  const h = normalized.headers;
  return requestCtx.run(
    {
      payment: h.get("x-payment") ?? h.get("x-payment-signature") ?? undefined,
      challenge: h.get("x-tiagoh-challenge") ?? undefined,
      payer: h.get("x-tiagoh-payer") ?? undefined,
    },
    () => handler(normalized),
  );
};
const DELETE = POST;

const GET = () =>
  new Response(
    JSON.stringify({
      name: "tiagoh",
      description:
        "Paid GOAT data tools in the $0.01–0.02 band (x402): live chain stats, gas, address/tx/token inspection, ERC-8004 registry activity, and BTC/GOATED market data. Every tool reads a live source at call time.",
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
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

export { GET, POST, DELETE };
export const runtime = "nodejs";
export const maxDuration = 60;
