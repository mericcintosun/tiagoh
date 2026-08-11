/**
 * Pay the HOSTED MCP endpoint — the surface an OpenClaw / ClawUp agent actually talks to.
 * Unlike `pay.ts` (which speaks tiagoh's own HTTP shape) this speaks plain MCP JSON-RPC and
 * carries the payment in headers, so it is the flow a third-party agent would use.
 */
import { createErc3009Payer, decodePaymentPayload } from "@tiagoh/goat";
import { privateKeyToAccount } from "viem/accounts";

/** `indexOf` returns -1 when a flag is absent, and argv[-1 + 1] is the node binary — guard it. */
const flag = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const URL_ = flag("url", "http://localhost:3099/api/mcp");
const TOOL = flag("tool", "get_goat_market_data");
const KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
const buyer = privateKeyToAccount(KEY);

const rpc = async (headers: Record<string, string>) => {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: TOOL, arguments: {} } }),
  });
  const raw = await res.text();
  const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  return JSON.parse(json.result.content[0].text);
};

const payer = createErc3009Payer({ privateKey: KEY, token: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8", chainId: 2345, rpcUrl: "https://rpc.goat.network" });

console.log(`buyer ${buyer.address} → ${URL_}  [${TOOL}]\n`);
const quote = await rpc({ "x-tiagoh-payer": buyer.address });
if (!quote.paymentRequired) { console.log("ücretsiz döndü:", quote); process.exit(0); }

const ch = JSON.parse(Buffer.from(quote.challenge, "base64").toString());
console.log(`402 → ${Number(ch.amount) / 1e6} USDC.e · settleTo ${ch.settleTo}`);

const payment = await payer.sign({ amount: ch.amount, asset: ch.asset, network: ch.network, settleTo: ch.settleTo, nonce: ch.nonce, expiresAt: ch.expiresAt });
console.log(`imzalandı, nonce ${decodePaymentPayload(payment)!.payload.authorization.nonce.slice(0, 14)}…`);

const paid = await rpc({ "x-tiagoh-payer": buyer.address, "x-payment": payment, "x-tiagoh-challenge": quote.challenge });
if (paid.paymentRequired) { console.error("\n✗ hâlâ ödeme isteniyor:", paid.reason); process.exit(1); }
console.log("\n✓ ödendi, veri geldi:");
console.log(JSON.stringify(paid, null, 2));
