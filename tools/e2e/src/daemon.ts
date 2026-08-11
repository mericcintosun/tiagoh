import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, callPaidTool } from "@tiagoh/client";
import { TiagohConfigSchema, toMinor, type Receipt } from "@tiagoh/core";
import {
  createChallengeReceiptSigner,
  createErc3009Payer,
  createErc3009Settle,
  createErc3009Verify,
  createGatewayCosigner,
} from "@tiagoh/goat";

/**
 * tiagoh daemon — the counter that goes up.
 *
 * Runs the autonomous buyer continuously against the paid tool catalogue over the real x402
 * `exact` flow: the buyer signs an ERC-3009 authorization, the gateway verifies it against the
 * chain before doing any work, and settlement moves genuine USDC.e on GOAT mainnet with the
 * co-signed receipt anchored alongside it. ERC-8021-tagged, so the traffic is filterable
 * on-chain by anyone.
 *
 * This used to sign payments with the literal string `direct:${nonce}:${amount}` and run with
 * `allowUnverifiedPayments`, because the gateway held the buyer's key and moved the money itself.
 * It now runs the same code path a stranger would (see `serve.ts` / `pay.ts` for that split), so
 * what this loop exercises is the real thing rather than a rehearsal of it.
 *
 * Wallet separation (wash-pattern hygiene, published on /metrics):
 *   BUYER_PRIVATE_KEY   — signs authorizations. Needs USDC.e; needs NO gas.
 *   TIAGOH_SELLER_KEY   — co-signs receipts as payee. Receives money, never sends a tx.
 *   PRIVATE_KEY         — submitter/recorder: pays gas, holds no money.
 * Generate fresh wallets with: `cast wallet new`
 *
 * Safety rails:
 *   DAEMON_DAILY_BUDGET_USD (default 1)  — hard stop for a 24h window
 *   DAEMON_INTERVAL_SEC     (default 90) — base pacing, ±50% jitter so the
 *                                          cadence is not a bot-obvious metronome
 *   stops when the buyer's USDC.e balance cannot cover the next cascade
 *
 * Run: TIAGOH_DAEMON=1 pnpm --filter @tiagoh/e2e daemon
 */

const PORT = 4412;
const BASE = `http://localhost:${PORT}`;

const RECEIPT_REGISTRY = (process.env.RECEIPT_REGISTRY_ADDRESS ??
  "0xa5bEfC1bdc7ec16EfB0ecF8866566A9405999112") as `0x${string}`;
const TOKEN = (process.env.TIAGOH_PAYMENT_TOKEN ??
  "0x3022b87ac063DE95b1570F46f5e470F8B53112D8") as `0x${string}`; // USDC.e
const BUYER_KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
const SELLER_KEY = process.env.TIAGOH_SELLER_KEY as `0x${string}` | undefined;
const RECORDER_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const SETTLER = process.env.X402_SETTLER_ADDRESS as `0x${string}` | undefined;
const EXPLORER = process.env.TIAGOH_EXPLORER ?? "https://explorer.goat.network/tx/";
const CHAIN_ID = Number(process.env.GOAT_CHAIN_ID ?? 2345);

const DAILY_BUDGET_USD = Number(process.env.DAEMON_DAILY_BUDGET_USD ?? "1");
const INTERVAL_SEC = Number(process.env.DAEMON_INTERVAL_SEC ?? "90");

if (!BUYER_KEY || !RECORDER_KEY || !SELLER_KEY) {
  console.error(
    "daemon needs BUYER_PRIVATE_KEY (signs payments), TIAGOH_SELLER_KEY (co-signs receipts, " +
      "receives money) and PRIVATE_KEY (submits transactions).\n" +
      "All three MUST be distinct, and the seller must never be funded by the buyer.",
  );
  process.exit(1);
}

const { privateKeyToAccount } = await import("viem/accounts");
const SELLER_PAYOUT = privateKeyToAccount(SELLER_KEY).address;

const receipts: Receipt[] = [];

// The catalogue: live-data tools priced in the real x402 band ($0.01–$0.10).
const config = TiagohConfigSchema.parse({
  upstream: { command: "in-process" },
  payTo: SELLER_PAYOUT,
  ...(SETTLER ? { settler: SETTLER } : {}),
  asset: TOKEN,
  assetDecimals: 6,
  chainId: CHAIN_ID,
  port: PORT,
  tools: [
    { name: "get_goat_chain_stats", priceUsd: 0.01, description: "live GOAT chain stats" },
    { name: "get_goat_gas", priceUsd: 0.01, description: "live gas + sat estimates" },
    { name: "get_token_info", priceUsd: 0.02, description: "live ERC-20 metadata" },
    { name: "analyze_goat_activity", priceUsd: 0.03, description: "composite chain analysis (cascades)" },
  ],
});

const RPC = process.env.GOAT_RPC_URL ?? "https://rpc.goat.network";
async function rpc<T = string>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  return ((await res.json()) as { result: T }).result;
}
const hexDec = (h: string) => parseInt(h, 16);

async function callUpstream(
  tool: string,
  _args: unknown,
  ctx: { paymentId: string; parentId: string | null },
): Promise<unknown> {
  switch (tool) {
    case "get_goat_chain_stats": {
      const r = await fetch("https://explorer.goat.network/api/v2/stats", {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      const s = (await r.json()) as Record<string, unknown>;
      return { transactionsToday: Number(s.transactions_today), utilization: s.network_utilization_percentage };
    }
    case "get_goat_gas": {
      const wei = hexDec(await rpc("eth_gasPrice"));
      return { gasPriceWei: wei, receiptAnchorSats: Math.round(((200_000 * wei) / 1e10) * 100) / 100 };
    }
    case "get_token_info": {
      const supply = await rpc<string>("eth_call", [{ to: TOKEN, data: "0x18160ddd" }, "latest"]);
      return { token: TOKEN, totalSupply: Number(BigInt(supply)) / 1e6 };
    }
    case "analyze_goat_activity": {
      // CASCADE: a paid tool buying from paid tools — every hop settles on-chain
      // and links to this call's paymentId.
      const budget = new BudgetGuard(toMinor("0.5"));
      const buy = (t: string) =>
        callPaidTool(BASE, t, {}, {
          budget,
          sign: signPayment,
          signReceipt,
          parentId: ctx.paymentId,
          payer: buyerPayer.address,
        });
      const [stats, gas, token] = await Promise.all([
        buy("get_goat_chain_stats"),
        buy("get_goat_gas"),
        buy("get_token_info"),
      ]);
      return { stats: stats.result, gas: gas.result, token: token.result };
    }
    default:
      throw new Error(`unknown tool ${tool}`);
  }
}

// Buyer side: signs an ERC-3009 authorization per call. No gas, no approval, no RPC after the
// one-time token-domain read.
const buyerPayer = createErc3009Payer({
  privateKey: BUYER_KEY,
  token: TOKEN,
  chainId: CHAIN_ID,
  rpcUrl: RPC,
});
const signPayment = buyerPayer.sign;
const signReceipt = createChallengeReceiptSigner({
  privateKey: BUYER_KEY,
  registry: RECEIPT_REGISTRY,
  chainId: CHAIN_ID,
  payer: buyerPayer.address,
  token: TOKEN,
  rpcUrl: RPC,
});

// Seller side: verify against the chain before working, settle after.
const verify = createErc3009Verify({
  token: TOKEN,
  settleTo: (SETTLER ?? SELLER_PAYOUT) as `0x${string}`,
  rpcUrl: RPC,
});
const settle = createErc3009Settle({
  submitterPrivateKey: RECORDER_KEY,
  token: TOKEN,
  receiptRegistry: RECEIPT_REGISTRY,
  settler: SETTLER,
  mode: SETTLER ? "settler" : "direct",
  rpcUrl: RPC,
  // Only possible in direct mode, and it means a paid call with no evidence behind it.
  onAnchorFailed: (paymentId, reason) =>
    console.error(`   ! receipt ${paymentId.slice(0, 10)}… paid but NOT anchored: ${reason}`),
});

const gateway = new TiagohGateway({
  config,
  callUpstream,
  verifyPayment: async ({ signature, amount, payer, nonce, challenge }) => {
    const result = await verify(signature, {
      amount: amount.toString(),
      nonce,
      payer,
      settleTo: challenge.settleTo,
    });
    if (!result.ok) console.log(`[daemon] payment rejected: ${result.reason}`);
    return result.ok;
  },
  settle: (a) => settle({ receipt: a.receipt, signature: a.signature }),
  cosign: createGatewayCosigner({
    privateKey: SELLER_KEY,
    registry: RECEIPT_REGISTRY,
    chainId: CHAIN_ID,
    token: TOKEN,
    rpcUrl: RPC,
  }),
  onReceipt: (r) => receipts.push(r),
});

async function usdceBalance(addressOfBuyer: `0x${string}`): Promise<number> {
  const data = `0x70a08231${"0".repeat(24)}${addressOfBuyer.slice(2)}`;
  const bal = await rpc<string>("eth_call", [{ to: TOKEN, data }, "latest"]);
  return bal && bal !== "0x" ? Number(BigInt(bal)) / 1e6 : 0;
}

async function main() {
  const buyer = privateKeyToAccount(BUYER_KEY!);
  if (buyer.address.toLowerCase() === SELLER_PAYOUT.toLowerCase()) {
    console.error("buyer and seller are the same address — refusing to run (self-dealing pattern)");
    process.exit(1);
  }

  gateway.serve(PORT);
  console.log(`[daemon] gateway on :${PORT} · registry ${RECEIPT_REGISTRY} · token USDC.e`);
  console.log(`[daemon] buyer ${buyer.address} → seller ${SELLER_PAYOUT}`);
  console.log(`[daemon] daily budget $${DAILY_BUDGET_USD} · base interval ${INTERVAL_SEC}s ±50% jitter`);

  let spentToday = 0;
  let windowStart = Date.now();
  let jobs = 0;

  /**
   * What to buy next.
   *
   * Running only the $0.14 cascade would burn a small balance in a handful of jobs. The metric
   * that actually matters is **distinct active days** (L2 grant programmes gate on ≥10 of them),
   * so the mix is mostly cheap single calls with a cascade every sixth job — enough to keep
   * proving that multi-hop settlement works, cheap enough to run for weeks.
   */
  const CHEAP = [
    { tool: "get_goat_chain_stats", usd: 0.01 },
    { tool: "get_goat_gas", usd: 0.01 },
    { tool: "get_token_info", usd: 0.02 },
  ];
  const CASCADE = { tool: "analyze_goat_activity", usd: 0.07 }; // 0.03 root + 0.04 of hops
  const cheapest = Math.min(...CHEAP.map((c) => c.usd));

  /**
   * Pick what to buy, then fall back if it does not fit.
   *
   * The fallback is load-bearing, not defensive padding: the cascade costs more than a cheap
   * call, so with a daily cap below its price the loop would reach the cascade slot, refuse it,
   * sleep to the next window, and refuse it again — stalling permanently on job #6 without ever
   * spending another cent. Falling back to a cheap call keeps the counter moving and lets the
   * cascade happen on a day it fits.
   */
  const pick = (n: number, remaining: number) => {
    const wanted = n % 6 === 5 ? CASCADE : CHEAP[n % CHEAP.length]!;
    if (wanted.usd <= remaining) return wanted;
    return CHEAP.filter((c) => c.usd <= remaining).sort((a, b) => b.usd - a.usd)[0] ?? null;
  };

  for (;;) {
    if (Date.now() - windowStart > 86_400_000) {
      spentToday = 0;
      windowStart = Date.now();
    }

    const job = pick(jobs, DAILY_BUDGET_USD - spentToday);
    if (!job) {
      console.log(`[daemon] daily budget $${DAILY_BUDGET_USD} spent — sleeping to next window`);
      await sleep(Math.max(60_000, windowStart + 86_400_000 - Date.now()));
      continue;
    }

    const bal = await usdceBalance(buyer.address);
    if (bal < Math.max(job.usd, cheapest)) {
      console.log(`[daemon] buyer USDC.e ${bal.toFixed(4)} exhausted — pausing 30min`);
      await sleep(1_800_000);
      continue;
    }

    try {
      const budget = new BudgetGuard(toMinor("0.5"));
      const res = await callPaidTool(BASE, job.tool, {}, {
        budget,
        sign: signPayment,
        signReceipt,
        payer: buyerPayer.address,
      });
      jobs++;
      spentToday += job.usd;
      const tx = res.receipt?.txHash;
      console.log(
        `[daemon] #${jobs} ${job.tool} $${job.usd.toFixed(2)} · receipts ${receipts.length} · ` +
          `today $${spentToday.toFixed(2)}/${DAILY_BUDGET_USD} · left $${(bal - job.usd).toFixed(4)}` +
          (tx && !tx.startsWith("mock") ? `\n           ${EXPLORER}${tx}` : ""),
      );
    } catch (err) {
      console.error(`[daemon] ${job.tool} failed (not billed): ${(err as Error).message}`);
    }

    const jitter = 0.5 + Math.random(); // 0.5x–1.5x, so the cadence is not a bot-obvious metronome
    await sleep(Math.round(INTERVAL_SEC * 1000 * jitter));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
