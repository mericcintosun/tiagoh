import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, callPaidTool } from "@tiagoh/client";
import { TiagohConfigSchema, toMinor, type Receipt } from "@tiagoh/core";
import { createDirectTransferSettle } from "@tiagoh/goat";

/**
 * tiagoh daemon — the counter that goes up.
 *
 * Runs the autonomous buyer continuously against the paid tool catalogue with
 * REAL on-chain settlement: every paid call is a genuine USDC.e transfer on GOAT
 * mainnet plus a receipt anchor, both ERC-8021-tagged. No mock signing.
 *
 * Wallet separation (wash-pattern hygiene, published on /metrics):
 *   BUYER_PRIVATE_KEY   — pays. Fund with bridged USDC.e + a little BTC gas.
 *   PRIVATE_KEY         — recorder (deployer): anchors receipts. Never pays.
 *   SELLER_PAYOUT       — receives. MUST NOT be funded from the buyer address.
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
const SELLER_PAYOUT = (process.env.SELLER_PAYOUT ?? "") as `0x${string}`;
const BUYER_KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
const RECORDER_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const EXPLORER = process.env.TIAGOH_EXPLORER ?? "https://explorer.goat.network/tx/";

const DAILY_BUDGET_USD = Number(process.env.DAEMON_DAILY_BUDGET_USD ?? "1");
const INTERVAL_SEC = Number(process.env.DAEMON_INTERVAL_SEC ?? "90");

if (!BUYER_KEY || !RECORDER_KEY || !SELLER_PAYOUT) {
  console.error(
    "daemon needs BUYER_PRIVATE_KEY, PRIVATE_KEY (recorder) and SELLER_PAYOUT env vars.\n" +
      "Buyer and seller MUST be distinct addresses, and the seller must not be funded by the buyer.",
  );
  process.exit(1);
}

const receipts: Receipt[] = [];

// The catalogue: live-data tools priced in the real x402 band ($0.01–$0.10).
const config = TiagohConfigSchema.parse({
  upstream: { command: "in-process" },
  payTo: SELLER_PAYOUT,
  asset: TOKEN,
  assetDecimals: 6,
  port: PORT,
  tools: [
    { name: "get_goat_chain_stats", priceUsd: 0.01, description: "live GOAT chain stats" },
    { name: "get_goat_gas", priceUsd: 0.01, description: "live gas + sat estimates" },
    { name: "get_token_info", priceUsd: 0.02, description: "live ERC-20 metadata" },
    { name: "analyze_goat_activity", priceUsd: 0.1, description: "composite chain analysis (cascades)" },
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
          signReceipt: signReceiptFor("daemon-analyst"),
          parentId: ctx.paymentId,
          payer: "daemon-analyst",
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

// Real settlement: buyer USDC.e transfer → seller, then receipt anchor. Both ERC-8021-tagged.
const settle = createDirectTransferSettle({
  buyerPrivateKey: BUYER_KEY,
  recorderPrivateKey: RECORDER_KEY,
  token: TOKEN,
  payTo: SELLER_PAYOUT,
  receiptRegistry: RECEIPT_REGISTRY,
});

// The 402 challenge is still answered with a signed acknowledgement; the money itself moves
// in `settle` as a real on-chain transfer (GOAT Flow ERC20_DIRECT model, self-hosted).
const signPayment = async (c: { nonce: string; amount: string }) => `direct:${c.nonce}:${c.amount}`;
const signReceiptFor = (who: string) => async (c: { receiptId: string }) => `direct-receipt:${who}:${c.receiptId}`;

const gateway = new TiagohGateway({
  config,
  callUpstream,
  allowUnverifiedPayments: true, // payment is verified by the on-chain transfer itself
  settle: (a) => settle({ paymentId: a.paymentId, tool: a.tool, amount: a.amount, parentId: a.parentId }),
  cosign: async (r) => `direct-receipt:seller:${r.paymentId}`,
  onReceipt: (r) => receipts.push(r),
});

async function usdceBalance(addressOfBuyer: `0x${string}`): Promise<number> {
  const data = `0x70a08231${"0".repeat(24)}${addressOfBuyer.slice(2)}`;
  const bal = await rpc<string>("eth_call", [{ to: TOKEN, data }, "latest"]);
  return bal && bal !== "0x" ? Number(BigInt(bal)) / 1e6 : 0;
}

async function main() {
  const { privateKeyToAccount } = await import("viem/accounts");
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

  for (;;) {
    if (Date.now() - windowStart > 86_400_000) {
      spentToday = 0;
      windowStart = Date.now();
    }
    const bal = await usdceBalance(buyer.address);
    if (bal < 0.2) {
      console.log(`[daemon] buyer USDC.e balance ${bal.toFixed(2)} too low — pausing 30min`);
      await sleep(1_800_000);
      continue;
    }
    if (spentToday + 0.16 > DAILY_BUDGET_USD) {
      console.log(`[daemon] daily budget $${DAILY_BUDGET_USD} reached — sleeping to next window`);
      await sleep(Math.max(60_000, windowStart + 86_400_000 - Date.now()));
      continue;
    }

    try {
      const budget = new BudgetGuard(toMinor("0.5"));
      const res = await callPaidTool(BASE, "analyze_goat_activity", {}, {
        budget,
        sign: signPayment,
        signReceipt: signReceiptFor("daemon-buyer"),
        payer: buyer.address,
      });
      jobs++;
      spentToday += 0.16; // 0.10 root + 0.04 hops + margin
      const tx = res.receipt?.txHash;
      console.log(
        `[daemon] job #${jobs} settled · receipts total ${receipts.length} · spent today $${spentToday.toFixed(2)}` +
          (tx && !tx.startsWith("mock") ? ` · ${EXPLORER}${tx}` : ""),
      );
    } catch (err) {
      console.error(`[daemon] job failed (not billed): ${(err as Error).message}`);
    }

    const jitter = 0.5 + Math.random(); // 0.5x–1.5x
    await sleep(Math.round(INTERVAL_SEC * 1000 * jitter));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
