/**
 * Pay using tool ARGUMENTS only — no custom HTTP headers anywhere.
 * This is the path an MCP host like ClawUp takes, where an agent cannot set headers.
 */
import { createErc3009Payer } from "@tiagoh/goat";
import { privateKeyToAccount } from "viem/accounts";

const flag = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i+1] ? process.argv[i+1]! : d; };
const URL_ = flag("url", "https://tiagoh.vercel.app/api/mcp");
const TOOL = flag("tool", "get_token_info");
const KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}`;
const buyer = privateKeyToAccount(KEY);

const call = async (a: Record<string, unknown>) => {
  const r = await fetch(URL_, { method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, // NO payment headers
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: TOOL, arguments: a } }) });
  const t = await r.text();
  return JSON.parse(JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)).result.content[0].text);
};

const payer = createErc3009Payer({ privateKey: KEY, token: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8", chainId: 2345, rpcUrl: "https://rpc.goat.network" });

console.log(`buyer ${buyer.address} → ${TOOL} (argümanla, başlıksız)\n`);
const quote = await call({ _payer: buyer.address });
if (!quote.paymentRequired) { console.log("ücretsiz döndü:", quote); process.exit(0); }
const ch = JSON.parse(Buffer.from(quote.challenge, "base64").toString());
console.log(`quote  → ${Number(ch.amount)/1e6} USDC.e`);
const _payment = await payer.sign({ amount: ch.amount, asset: ch.asset, network: ch.network, settleTo: ch.settleTo, nonce: ch.nonce, expiresAt: ch.expiresAt });
const paid = await call({ _payer: buyer.address, _challenge: quote.challenge, _payment });
if (paid.paymentRequired) { console.error("✗ reddedildi:", paid.reason); process.exit(1); }
console.log("✓ argümanla ödendi, veri geldi:\n ", JSON.stringify(paid).slice(0, 180));
