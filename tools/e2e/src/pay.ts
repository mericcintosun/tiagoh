import { BudgetGuard, callPaidTool, listPaidTools } from "@tiagoh/client";
import { formatMinor, parseMinor, toMinor } from "@tiagoh/core";
import {
  createErc3009Payer,
  createChallengeReceiptSigner,
  goatPublicClient,
  isReceiptCosigned,
} from "@tiagoh/goat";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The BUYER half of the two-process demo — a stranger paying a gateway it does not run.
 *
 * This process holds one key. It never talks to the gateway's keys, never learns the seller's
 * payout address until the 402 tells it, and — the part worth watching — **never sends a
 * transaction**. It signs an ERC-3009 authorization and puts it in an HTTP header; the seller
 * relays it and pays the gas. A wallet holding nothing but USDC.e and zero BTC can buy tool
 * calls, which is what makes onboarding an external agent a matter of holding a stablecoin
 * rather than bridging gas first.
 *
 * Run:  BUYER_PRIVATE_KEY=0x… pnpm --filter @tiagoh/e2e pay -- --url http://localhost:4402
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const BASE = flag("url", "http://localhost:4402")!;
const TOOL = flag("tool");
const BUDGET = flag("budget", "0.20")!;
const RPC = process.env.GOAT_RPC_URL ?? "https://rpc.goat.network";
const CHAIN_ID = Number(process.env.GOAT_CHAIN_ID ?? 2345);
const EXPLORER = process.env.TIAGOH_EXPLORER ?? "https://explorer.goat.network/tx/";
const TOKEN = (process.env.TIAGOH_PAYMENT_TOKEN ??
  "0x3022b87ac063DE95b1570F46f5e470F8B53112D8") as `0x${string}`;
const RECEIPT_REGISTRY = (process.env.RECEIPT_REGISTRY_ADDRESS ??
  "0xa5bEfC1bdc7ec16EfB0ecF8866566A9405999112") as `0x${string}`;

const BUYER_KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!BUYER_KEY) {
  console.error("pay needs BUYER_PRIVATE_KEY. Generate one with `cast wallet new`.");
  process.exit(1);
}

const buyer = privateKeyToAccount(BUYER_KEY);
const pub = goatPublicClient({ rpcUrl: RPC });

const payer = createErc3009Payer({
  privateKey: BUYER_KEY,
  token: TOKEN,
  chainId: CHAIN_ID,
  rpcUrl: RPC,
});

const signReceipt = createChallengeReceiptSigner({
  privateKey: BUYER_KEY,
  registry: RECEIPT_REGISTRY,
  chainId: CHAIN_ID,
  payer: buyer.address,
  token: TOKEN,
  rpcUrl: RPC,
});

const money = (v: string | bigint) => formatMinor(parseMinor(v), 6);

async function usdce(address: `0x${string}`): Promise<bigint> {
  const data = `0x70a08231${"0".repeat(24)}${address.slice(2)}` as `0x${string}`;
  const raw = await pub.call({ to: TOKEN, data });
  return raw.data && raw.data !== "0x" ? BigInt(raw.data) : 0n;
}

let failed = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) failed++;
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${msg}`);
};

async function main() {
  const gasWei = await pub.getBalance({ address: buyer.address });
  const startUsdc = await usdce(buyer.address);

  console.log("── tiagoh buyer (external process) ──");
  console.log(`   buyer     ${buyer.address}`);
  console.log(`   USDC.e    ${money(startUsdc)}`);
  console.log(`   BTC gas   ${Number(gasWei) / 1e10} sats${gasWei === 0n ? "   ← zero, and that is the point" : ""}`);
  console.log(`   gateway   ${BASE}\n`);

  const tools = await listPaidTools(BASE);
  console.log("discovered priced tools:");
  for (const t of tools) {
    console.log(`   ${t.name.padEnd(24)} ${money(t._meta?.tiagoh?.amount ?? "0")} USDC.e`);
  }

  const budget = new BudgetGuard(toMinor(BUDGET));
  const wanted = TOOL ? [TOOL] : ["get_goat_chain_stats", "analyze_goat_activity"];
  console.log(`\nsession budget ${money(budget.remaining)} USDC.e\n`);

  const bought: Array<{ tool: string; receiptId: string; txHash?: string }> = [];
  for (const tool of wanted) {
    const priced = tools.find((t) => t.name === tool);
    if (!priced) {
      console.log(`   — ${tool}: not offered by this gateway, skipping`);
      continue;
    }
    console.log(`[pay] ${tool}`);
    const { receipt } = await callPaidTool(BASE, tool, {}, {
      budget,
      sign: payer.sign,
      signReceipt,
      payer: buyer.address,
    });
    bought.push({ tool, receiptId: receipt.paymentId, txHash: receipt.txHash });
    console.log(
      `   paid ${money(receipt.amount)} USDC.e · remaining ${money(budget.remaining)}` +
        (receipt.txHash ? `\n   ${EXPLORER}${receipt.txHash}` : ""),
    );
  }

  console.log("\n── verifying against the chain ──");
  const endGas = await pub.getBalance({ address: buyer.address });
  const endUsdc = await usdce(buyer.address);

  assert(endGas === gasWei, `buyer spent no gas (${Number(endGas) / 1e10} sats, unchanged)`);
  assert(endUsdc < startUsdc, `buyer was debited ${money(startUsdc - endUsdc)} USDC.e`);

  for (const b of bought) {
    // The receipt is only evidence if BOTH parties signed it. An unpaid-for claim, or a receipt
    // the seller wrote alone, cannot back a dispute — so this is the assertion that matters.
    const cosigned = await isReceiptCosigned(RECEIPT_REGISTRY, b.receiptId, { rpcUrl: RPC });
    assert(cosigned, `${b.tool}: receipt anchored on-chain and co-signed (dispute-grade)`);
  }

  console.log(
    failed === 0
      ? "\n✓ an external wallet with zero gas paid for tool calls, and every receipt is evidence"
      : `\n✗ ${failed} assertion(s) failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\npayment failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
