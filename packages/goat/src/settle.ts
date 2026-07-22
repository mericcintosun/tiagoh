import { keccak256, toHex, type Address, type Hex } from "viem";
import { goatWalletClient, goatPublicClient } from "./clients.js";

const RECEIPT_REGISTRY_ABI = [
  {
    type: "function",
    name: "recordReceipt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiptId", type: "bytes32" },
      { name: "parentId", type: "bytes32" },
      { name: "payer", type: "address" },
      { name: "payee", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "toolId", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const ZERO32 = ("0x" + "0".repeat(64)) as Hex;
const b32 = (s: string): Hex => keccak256(toHex(s));

export interface OnchainSettleOptions {
  privateKey: Hex;
  receiptRegistry: Address;
  token?: Address;
  payer?: Address;
  payee?: Address;
  rpcUrl?: string;
  /** wei; GOAT testnet enforces a minimum priority fee (~130000). */
  priorityGasPrice?: bigint;
  maxGasPrice?: bigint;
  /**
   * Optional hook run after a receipt is anchored, on the same serialized queue (so it never
   * races the next settle's nonce). Use it to auto-split revenue to upstream providers — pass
   * `createRevenueSplitRelease(...)` when the wrapped tool's payee is a RevenueSplit.
   */
  postSettle?: (result: { txHash: string; payee: Address; paymentId: string }) => Promise<unknown>;
}

/**
 * A gateway `settle` that anchors each settled call to the on-chain ReceiptRegistry
 * on GOAT — the off-chain x402 flow producing real, verifiable receipts. Transactions
 * are serialized to avoid nonce races (e.g. from a cascade's concurrent downstream hops).
 */
export function createOnchainSettle(opts: OnchainSettleOptions) {
  const wallet = goatWalletClient(opts.privateKey, { rpcUrl: opts.rpcUrl });
  const pub = goatPublicClient({ rpcUrl: opts.rpcUrl });
  const token = opts.token ?? ("0x1111111111111111111111111111111111111111" as Address);
  const from = wallet.account.address;
  const payer = opts.payer ?? from;
  const payee = opts.payee ?? from;
  const priority = opts.priorityGasPrice ?? 200000n;
  const maxFee = opts.maxGasPrice ?? 1000000n;

  let queue: Promise<unknown> = Promise.resolve();

  return (args: {
    paymentId: string;
    tool: string;
    amountUsd: number;
    parentId: string | null;
  }): Promise<{ txHash: string; payee: Address }> => {
    const run = async (): Promise<{ txHash: string; payee: Address }> => {
      const nonce = await pub.getTransactionCount({ address: from, blockTag: "pending" });
      const hash = await wallet.writeContract({
        address: opts.receiptRegistry,
        abi: RECEIPT_REGISTRY_ABI,
        functionName: "recordReceipt",
        args: [
          b32(args.paymentId),
          args.parentId ? b32(args.parentId) : ZERO32,
          payer,
          payee,
          token,
          BigInt(Math.max(0, Math.round(args.amountUsd * 100))),
          b32(args.tool),
        ],
        nonce,
        maxPriorityFeePerGas: priority,
        maxFeePerGas: maxFee,
      });
      await pub.waitForTransactionReceipt({ hash });
      // Optional post-settle step (e.g. RevenueSplit auto-split), on the same serialized queue.
      if (opts.postSettle) {
        try {
          await opts.postSettle({ txHash: hash, payee, paymentId: args.paymentId });
        } catch {
          // A split/hook failure must not undo a settled receipt; surface via the hook's own logs.
        }
      }
      return { txHash: hash, payee };
    };
    // Serialize: each settle waits for the previous tx to be mined (nonce safety).
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  };
}

export interface FacilitatorOptions {
  /** Hosted GOAT x402 facilitator endpoint (exposes POST /verify and POST /settle). */
  facilitatorUrl: string;
  /** Seller payout address (the `payTo` the facilitator settles to). */
  payTo: Address;
  /** ERC-3009 / Permit2 payment token the facilitator settles. */
  asset: Address;
  /** CAIP-2-ish network id advertised in payment requirements, e.g. "goat:48816". */
  network?: string;
  /** Optional bearer key for the facilitator. */
  apiKey?: string;
  /** Injected fetch (defaults to global fetch; Node 20+). */
  fetchImpl?: typeof fetch;
  /**
   * Optional receipt anchor run after a successful settle — pass `createOnchainSettle(...)` (or a
   * thin wrapper) to write the ReceiptRegistry entry once the facilitator has moved the money.
   */
  anchor?: (a: {
    paymentId: string;
    tool: string;
    amountUsd: number;
    parentId: string | null;
  }) => Promise<{ txHash: string; payee: Address }>;
}

/** Decode the client's X-PAYMENT header value (raw JSON or base64 JSON) into a payload object. */
function decodePaymentPayload(signature: string): unknown {
  const s = signature.trim();
  if (s.startsWith("{")) {
    try {
      return JSON.parse(s);
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
  } catch {
    // Not decodable JSON — forward the raw string; the facilitator rejects malformed payloads.
    return s;
  }
}

function requirements(opts: FacilitatorOptions, tool: string, amountUsd: number) {
  return {
    scheme: "exact",
    network: opts.network ?? "goat:48816",
    asset: opts.asset,
    payTo: opts.payTo,
    // USDC-style 6-decimal minor units; adjust per the deployment's payment token.
    maxAmountRequired: String(Math.max(0, Math.round(amountUsd * 1e6))),
    resource: `tool:${tool}`,
    mimeType: "application/json",
  };
}

/**
 * The REAL x402 verify step (facilitator POST /verify). Returns true only if the facilitator
 * confirms the buyer's signed authorization is valid and settleable. Wire it into the gateway's
 * `verifyPayment` hook so the seller never runs a tool against a signature that cannot settle.
 * Any transport/error → false (fail closed → the gateway re-challenges with 402).
 */
export function createFacilitatorVerify(opts: FacilitatorOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  return async (args: {
    tool: string;
    priceUsd: number;
    asset: string;
    signature: string;
    payer: string;
    parentId: string | null;
  }): Promise<boolean> => {
    const res = await doFetch(`${opts.facilitatorUrl.replace(/\/$/, "")}/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: decodePaymentPayload(args.signature),
        paymentRequirements: requirements(opts, args.tool, args.priceUsd),
      }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { isValid?: boolean; valid?: boolean };
    return body.isValid === true || body.valid === true;
  };
}

/**
 * The REAL settlement path (facilitator POST /settle): the facilitator submits the buyer's
 * signed ERC-3009 / Permit2 authorization on-chain, then we anchor the receipt. Drop-in for
 * `createOnchainSettle` as the gateway `SettleFn` once the GOAT x402 faucet/endpoint is granted —
 * the SettleFn shape is unchanged, so nothing else moves. Env-gated: only used when a
 * `facilitatorUrl` is configured.
 */
export function createFacilitatorSettle(opts: FacilitatorOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  return async (args: {
    paymentId: string;
    tool: string;
    amountUsd: number;
    payer: string;
    parentId: string | null;
    signature: string;
  }): Promise<{ txHash?: string; payee: Address }> => {
    const res = await doFetch(`${opts.facilitatorUrl.replace(/\/$/, "")}/settle`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: decodePaymentPayload(args.signature),
        paymentRequirements: requirements(opts, args.tool, args.amountUsd),
      }),
    });
    if (!res.ok) throw new Error(`facilitator settle failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      success?: boolean;
      errorReason?: string;
      transaction?: string;
      txHash?: string;
    };
    if (!body.success) throw new Error(`facilitator settle rejected: ${body.errorReason ?? "unknown"}`);

    const txHash = body.transaction ?? body.txHash;
    // Anchor the settled call on-chain (ReceiptRegistry) if an anchor was provided.
    if (opts.anchor) {
      const anchored = await opts.anchor({
        paymentId: args.paymentId,
        tool: args.tool,
        amountUsd: args.amountUsd,
        parentId: args.parentId,
      });
      return { txHash: txHash ?? anchored.txHash, payee: anchored.payee };
    }
    return { txHash, payee: opts.payTo };
  };
}
