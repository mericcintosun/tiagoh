import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, callPaidTool } from "@tiagoh/client";
import { TiagohConfigSchema, formatMinor, parseMinor, toMinor, type Receipt } from "@tiagoh/core";
import {
  createErc3009Payer,
  createErc3009Settle,
  createErc3009Verify,
  createChallengeReceiptSigner,
  createGatewayCosigner,
} from "@tiagoh/goat";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The SELLER half of the two-process demo.
 *
 * This process has no buyer key and cannot obtain one. It serves priced tools, verifies each
 * incoming payment authorization against the chain, runs the tool, counter-signs the receipt and
 * submits the settlement. That separation is the point: everything the old daemon did in one
 * process — where the "buyer" was a variable the seller could read — is now split across a
 * network boundary, which is what "a stranger can pay us" actually means.
 *
 * Keys, and what each one is allowed to do:
 *
 *   TIAGOH_SELLER_KEY  the seller identity. Counter-signs receipts as payee, and its address is
 *                      `payTo`. Signs only — it never sends a transaction, so it needs no gas and
 *                      its nonce stays at zero. That is deliberate: a payout address that never
 *                      spends is the cleanest possible answer to "is this wash traffic?".
 *   PRIVATE_KEY        the submitter/relayer. Pays gas, touches no money.
 *   COMPOSER_KEY       optional. The composite tool is a *buyer* of its own sub-tools, so it needs
 *                      its own funded wallet. Without it, the composite tool is served flat.
 *
 * Run:  TIAGOH_SELLER_KEY=0x… PRIVATE_KEY=0x… pnpm --filter @tiagoh/e2e serve
 */

const PORT = Number(process.env.PORT ?? 4402);
const BASE = `http://localhost:${PORT}`;
const RPC = process.env.GOAT_RPC_URL ?? "https://rpc.goat.network";
const CHAIN_ID = Number(process.env.GOAT_CHAIN_ID ?? 2345);
const EXPLORER = process.env.TIAGOH_EXPLORER ?? "https://explorer.goat.network/tx/";

const TOKEN = (process.env.TIAGOH_PAYMENT_TOKEN ??
  "0x3022b87ac063DE95b1570F46f5e470F8B53112D8") as `0x${string}`; // USDC.e
const RECEIPT_REGISTRY = (process.env.RECEIPT_REGISTRY_ADDRESS ??
  "0xa5bEfC1bdc7ec16EfB0ecF8866566A9405999112") as `0x${string}`;
const SETTLER = process.env.X402_SETTLER_ADDRESS as `0x${string}` | undefined;

const SELLER_KEY = process.env.TIAGOH_SELLER_KEY as `0x${string}` | undefined;
const SUBMITTER_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const COMPOSER_KEY = process.env.COMPOSER_KEY as `0x${string}` | undefined;

if (!SELLER_KEY || !SUBMITTER_KEY) {
  console.error(
    "serve needs TIAGOH_SELLER_KEY (co-signs receipts, holds no gas) and PRIVATE_KEY (submits " +
      "transactions, holds no money).\nGenerate them with `cast wallet new`.",
  );
  process.exit(1);
}

const seller = privateKeyToAccount(SELLER_KEY);
const composer = COMPOSER_KEY ? privateKeyToAccount(COMPOSER_KEY) : null;
const receipts: Receipt[] = [];

const config = TiagohConfigSchema.parse({
  upstream: { command: "in-process" },
  payTo: seller.address,
  ...(SETTLER ? { settler: SETTLER } : {}),
  asset: TOKEN,
  assetDecimals: 6,
  chainId: CHAIN_ID,
  port: PORT,
  tools: [
    { name: "get_goat_chain_stats", priceUsd: 0.01, description: "live GOAT chain stats" },
    { name: "get_goat_gas", priceUsd: 0.01, description: "live gas price + satoshi estimates" },
    { name: "get_token_info", priceUsd: 0.02, description: "live ERC-20 metadata on GOAT" },
    {
      name: "analyze_goat_activity",
      priceUsd: 0.05,
      description: "composite chain analysis (buys the three tools above)",
    },
  ],
});

// ── the tools (every one reads GOAT at call time) ────────────────────────────

async function rpc<T = string>(method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  return ((await res.json()) as { result: T }).result;
}

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
      return {
        transactionsToday: Number(s.transactions_today),
        utilizationPct: s.network_utilization_percentage,
        gasUsedToday: Number(s.gas_used_today),
      };
    }
    case "get_goat_gas": {
      const wei = parseInt(await rpc("eth_gasPrice"), 16);
      return {
        gasPriceWei: wei,
        settlementSats: Math.round(((265_000 * wei) / 1e10) * 100) / 100,
      };
    }
    case "get_token_info": {
      const supply = await rpc<string>("eth_call", [{ to: TOKEN, data: "0x18160ddd" }, "latest"]);
      return { token: TOKEN, symbol: "USDC.e", totalSupply: Number(BigInt(supply)) / 1e6 };
    }
    case "analyze_goat_activity": {
      if (!composer || !composerPay) {
        return {
          note: "composite served flat — set COMPOSER_KEY to have this tool buy its sub-tools",
        };
      }
      // CASCADE: a paid tool that is itself a paying buyer. Each hop settles on-chain and links
      // to this call's paymentId, and now each hop's receipt is co-signable too, because the
      // challenge carries the parent the buyer must sign over.
      const budget = new BudgetGuard(toMinor("0.20"));
      const buy = (t: string) =>
        callPaidTool(BASE, t, {}, {
          budget,
          sign: composerPay.sign,
          signReceipt: composerSignReceipt!,
          parentId: ctx.paymentId,
          payer: composer.address,
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

// ── the payment plumbing ─────────────────────────────────────────────────────

const composerPay = composer
  ? createErc3009Payer({ privateKey: COMPOSER_KEY!, token: TOKEN, chainId: CHAIN_ID, rpcUrl: RPC })
  : null;
const composerSignReceipt = composer
  ? createChallengeReceiptSigner({
      privateKey: COMPOSER_KEY!,
      registry: RECEIPT_REGISTRY,
      chainId: CHAIN_ID,
      payer: composer.address,
      token: TOKEN,
      rpcUrl: RPC,
    })
  : null;

const verify = createErc3009Verify({
  token: TOKEN,
  settleTo: (SETTLER ?? seller.address) as `0x${string}`,
  rpcUrl: RPC,
});

const settle = createErc3009Settle({
  submitterPrivateKey: SUBMITTER_KEY,
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
  // No `allowUnverifiedPayments`. Every payment is checked against the chain before any work
  // happens: the signature must recover to the challenged payer, the nonce must be unspent, the
  // window open and the balance sufficient.
  verifyPayment: async ({ signature, amount, payer, nonce, challenge }) => {
    const result = await verify(signature, {
      amount: amount.toString(),
      nonce,
      payer,
      settleTo: challenge.settleTo,
    });
    if (!result.ok) console.log(`   ✗ payment rejected: ${result.reason}`);
    return result.ok;
  },
  settle: async (a) => settle({ receipt: a.receipt, signature: a.signature }),
  cosign: createGatewayCosigner({
    privateKey: SELLER_KEY,
    registry: RECEIPT_REGISTRY,
    chainId: CHAIN_ID,
    token: TOKEN,
    rpcUrl: RPC,
  }),
  onReceipt: (r) => {
    receipts.push(r);
    const cosigned = r.payerSignature && r.payeeSignature ? "co-signed" : "telemetry";
    console.log(
      `   ✓ ${r.tool.padEnd(24)} ${formatMinor(parseMinor(r.amount), 6)} USDC.e · ${cosigned}` +
        (r.parentId ? ` · hop of ${r.parentId.slice(0, 10)}…` : "") +
        (r.txHash ? `\n     ${EXPLORER}${r.txHash}` : ""),
    );
  },
});

gateway.serve(PORT);

console.log("── tiagoh gateway (seller process) ──");
console.log(`   listening      http://localhost:${PORT}`);
console.log(`   seller (payTo) ${seller.address}   [signs only, never sends a tx]`);
console.log(`   submitter      ${privateKeyToAccount(SUBMITTER_KEY).address}   [pays gas only]`);
console.log(`   composer       ${composer ? composer.address : "(not set — composite served flat)"}`);
console.log(`   token          ${TOKEN} (USDC.e)`);
console.log(`   settlement     ${SETTLER ? `atomic via X402Settler ${SETTLER}` : "direct (2 tx)"}`);
console.log(`   registry       ${RECEIPT_REGISTRY}`);
console.log("\n   this process holds NO buyer key. waiting for someone to pay…\n");
