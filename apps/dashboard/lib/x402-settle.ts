import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseSignature,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { goatChain } from "@/lib/wagmi";

/**
 * Verify and settle an x402 `exact` payment — the dashboard's own copy.
 *
 * This duplicates a slice of `@tiagoh/goat`, deliberately. The dashboard is deployed as a
 * standalone Next.js project: Vercel installs it with npm, outside the pnpm workspace, so a
 * `workspace:*` dependency simply cannot resolve there. Importing the SDK broke a property the
 * app was built around — self-contained, deployable anywhere with no workspace build step — and
 * the deploy failed on exactly that.
 *
 * So the trade is duplication for deployability, and it is a small trade because the hosted
 * endpoint needs far less than the SDK offers: its callers are standard MCP clients that sign a
 * payment but produce no tiagoh receipt signatures, which means only the `settleBare` path is
 * ever taken. `packages/goat/src/erc3009.ts` remains canonical; if the two ever disagree, that
 * one is right.
 */

const RPC = process.env.GOAT_RPC_URL ?? "https://rpc.goat.network";

/** ERC-8021 builder tag, so tiagoh's transactions stay filterable on-chain by anyone. */
const ERC8021_MARKER = "0x80218021802180218021802180218021";
const BUILDER_CODE = stringToHex("tiagoh").slice(2);
const withBuilderCode = (data: Hex): Hex =>
  (data + ERC8021_MARKER.slice(2) + "00" + BUILDER_CODE) as Hex;

const ERC3009_ABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const SETTLER_ABI = [
  {
    type: "function",
    name: "settleBare",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "auth",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "receiptId", type: "bytes32" },
      { name: "parentId", type: "bytes32" },
      { name: "toolId", type: "bytes32" },
      { name: "payee", type: "address" },
    ],
    outputs: [],
  },
] as const;

export interface Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

interface PaymentPayload {
  payload: { signature: Hex; authorization: Authorization };
}

/** Accepts base64 (the spec) or raw JSON (what a human debugging with curl sends). */
export function decodePayment(header: string): PaymentPayload | null {
  const raw = header.trim();
  const parse = (text: string): PaymentPayload | null => {
    try {
      const p = JSON.parse(text) as PaymentPayload;
      return p?.payload?.authorization ? p : null;
    } catch {
      return null;
    }
  };
  if (raw.startsWith("{")) return parse(raw);
  try {
    return parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Pull the actual revert reason out of a viem error; the generic first line is useless. */
function reasonOf(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.reason ?? reverted.shortMessage;
    }
    return err.shortMessage.replace(/\s+/g, " ").slice(0, 200);
  }
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 200);
}

function splitSig(signature: Hex): { v: number; r: Hex; s: Hex } {
  const p = parseSignature(signature);
  return { v: Number(p.v ?? (p.yParity === 0 ? 27n : 28n)), r: p.r, s: p.s };
}

const publicClient = () => createPublicClient({ chain: goatChain, transport: http(RPC) });

export type VerifyResult =
  | { ok: true; authorization: Authorization; signature: Hex }
  | { ok: false; reason: string };

/**
 * The x402 `verify` step, answered by the chain instead of a facilitator.
 *
 * Cheap structural checks first, then `eth_call` the transfer — which is also what closes replay
 * without any server-side state: a spent authorization fails here, because the token records its
 * own nonces, and this runs before the tool does.
 */
export async function verifyPayment(
  header: string,
  expect: { token: Address; amount: string; nonce: string; payer: string; settleTo: string },
): Promise<VerifyResult> {
  const decoded = decodePayment(header);
  if (!decoded) return { ok: false, reason: "payment header is not a decodable x402 payload" };

  const { authorization: a, signature } = decoded.payload;
  const eq = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();

  if (!eq(a.from, expect.payer)) return { ok: false, reason: "signer is not the challenged payer" };
  if (!eq(a.to, expect.settleTo)) return { ok: false, reason: `authorization pays ${a.to}` };
  if (a.value !== expect.amount) return { ok: false, reason: "amount does not match the price" };
  if (!eq(a.nonce, expect.nonce)) return { ok: false, reason: "nonce does not match the challenge" };

  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validBefore) <= now) return { ok: false, reason: "authorization has expired" };
  if (Number(a.validAfter) >= now) return { ok: false, reason: "authorization is not yet valid" };

  let v: number, r: Hex, s: Hex;
  try {
    ({ v, r, s } = splitSig(signature));
  } catch {
    return { ok: false, reason: "signature is malformed" };
  }

  try {
    await publicClient().simulateContract({
      address: expect.token,
      abi: ERC3009_ABI,
      functionName: "transferWithAuthorization",
      args: [
        a.from,
        a.to,
        BigInt(a.value),
        BigInt(a.validAfter),
        BigInt(a.validBefore),
        a.nonce,
        v,
        r,
        s,
      ],
      account: a.from,
    });
  } catch (err) {
    return { ok: false, reason: `authorization is not settleable: ${reasonOf(err)}` };
  }

  return { ok: true, authorization: a, signature };
}

/**
 * Settle through `X402Settler.settleBare`: one transaction that pulls the authorization, takes
 * the protocol fee, pays the seller and records the receipt.
 *
 * `settleBare` rather than `settle` because a standard MCP client produces no tiagoh receipt
 * signatures, so the receipt is RECORDER-level. It is still stronger than gateway telemetry: it
 * is written in the same transaction as a real token transfer, so it cannot describe a payment
 * that did not happen.
 */
export async function settleBare(args: {
  submitterKey: Hex;
  settler: Address;
  header: string;
  receiptId: Hex;
  toolId: Hex;
  payee: Address;
}): Promise<{ txHash: Hex }> {
  const decoded = decodePayment(args.header);
  if (!decoded) throw new Error("settle called without a decodable payment payload");
  const { authorization: a, signature } = decoded.payload;

  const account = privateKeyToAccount(args.submitterKey);
  const wallet = createWalletClient({ account, chain: goatChain, transport: http(RPC) });
  const pub = publicClient();

  const data = withBuilderCode(
    encodeFunctionData({
      abi: SETTLER_ABI,
      functionName: "settleBare",
      args: [
        {
          from: a.from,
          to: a.to,
          value: BigInt(a.value),
          validAfter: BigInt(a.validAfter),
          validBefore: BigInt(a.validBefore),
          nonce: a.nonce,
        },
        signature,
        args.receiptId,
        `0x${"0".repeat(64)}` as Hex,
        args.toolId,
        args.payee,
      ],
    }),
  );

  const nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hash = await wallet.sendTransaction({
    to: args.settler,
    data,
    nonce,
    // GOAT enforces a minimum priority fee (~130000 wei).
    maxPriorityFeePerGas: 200_000n,
    maxFeePerGas: 1_000_000n,
  });
  await pub.waitForTransactionReceipt({ hash });
  return { txHash: hash };
}
