import { keccak256, toHex, type Address, type Hex } from "viem";
import type { Receipt } from "@tiagoh/core";
import { goatWalletClient, goatPublicClient } from "./clients.js";

/**
 * Co-signed receipts — the piece that turns a receipt from the seller's word into evidence.
 *
 * A receipt written by the gateway alone proves nothing: the gateway is the seller's own
 * infrastructure, so it could mint receipts for calls that never happened, and equally could
 * decline to write one for a call that did. `ReceiptRegistry.anchorReceipt` therefore accepts a
 * receipt only when it carries an EIP-712 signature from **both** the payer and the payee — and
 * once it does, anyone may submit it, so neither side can suppress it either.
 *
 * That is also what makes recourse reachable on the instant-settle path: `DisputeArbiter` binds
 * a bond slash to a co-signed receipt, with no escrow required.
 */

/** The EIP-712 type, byte-for-byte what `ReceiptRegistry.RECEIPT_TYPEHASH` hashes. */
export const RECEIPT_TYPES = {
  Receipt: [
    { name: "receiptId", type: "bytes32" },
    { name: "parentId", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "payee", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "toolId", type: "bytes32" },
  ],
} as const;

const ZERO32 = `0x${"0".repeat(64)}` as Hex;

/**
 * The on-chain identifier for a tool. keccak256 of the tool name, because this is what
 * `QualityBond` keys bonds on and what `DisputeArbiter` compares a receipt against — one
 * derivation everywhere, or a receipt and a bond will disagree about which tool is on the hook.
 */
export function toolId(tool: string): Hex {
  return keccak256(toHex(tool));
}

/** Normalizes an off-chain id (a `0x…` hex string, or any string) into a `bytes32`. */
export function asBytes32(value: string | null | undefined): Hex {
  if (!value) return ZERO32;
  return /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as Hex) : keccak256(toHex(value));
}

/** The exact tuple both parties sign and the registry stores. */
export interface ReceiptStruct {
  receiptId: Hex;
  parentId: Hex;
  payer: Address;
  payee: Address;
  token: Address;
  amount: bigint;
  toolId: Hex;
}

/** Build the signable struct from a tiagoh receipt. */
export function receiptStruct(receipt: Receipt, token: Address): ReceiptStruct {
  return {
    receiptId: asBytes32(receipt.paymentId),
    parentId: asBytes32(receipt.parentId),
    payer: receipt.payer as Address,
    payee: receipt.payee as Address,
    token,
    amount: BigInt(receipt.amount),
    toolId: toolId(receipt.tool),
  };
}

export interface ReceiptSignerOptions {
  privateKey: Hex;
  /** The ReceiptRegistry this signature is scoped to (part of the EIP-712 domain). */
  registry: Address;
  chainId: number;
  rpcUrl?: string;
}

/**
 * Signs receipts as one party. The domain binds chainId + registry address, so a signature
 * harvested from one chain or one deployment is dead everywhere else.
 */
export function createReceiptSigner(opts: ReceiptSignerOptions) {
  const wallet = goatWalletClient(opts.privateKey, { rpcUrl: opts.rpcUrl });

  const domain = {
    name: "tiagoh ReceiptRegistry",
    version: "1",
    chainId: opts.chainId,
    verifyingContract: opts.registry,
  } as const;

  return {
    address: wallet.account.address,
    /** Sign a fully-formed struct (used by both the buyer's pre-sign and the seller's counter-sign). */
    async sign(message: ReceiptStruct): Promise<Hex> {
      return wallet.signTypedData({
        account: wallet.account,
        domain,
        types: RECEIPT_TYPES,
        primaryType: "Receipt",
        message,
      });
    },
  };
}

/**
 * Buyer-side signer for `createPayingFetch`'s `signReceipt` hook. The 402 challenge carries the
 * deterministic `receiptId`, which is exactly why it is deterministic: the buyer has to be able
 * to sign the bill before the seller does the work.
 */
export function createChallengeReceiptSigner(
  opts: ReceiptSignerOptions & { payer: Address; token: Address },
) {
  const signer = createReceiptSigner(opts);
  return async (challenge: {
    receiptId: string;
    payTo: string;
    tool: string;
    amount: string;
  }): Promise<Hex> =>
    signer.sign({
      receiptId: asBytes32(challenge.receiptId),
      parentId: ZERO32,
      payer: opts.payer,
      payee: challenge.payTo as Address,
      token: opts.token,
      amount: BigInt(challenge.amount),
      toolId: toolId(challenge.tool),
    });
}

/** Seller-side counter-signer for the gateway's `cosign` hook. */
export function createGatewayCosigner(opts: ReceiptSignerOptions & { token: Address }) {
  const signer = createReceiptSigner(opts);
  return async (receipt: Receipt): Promise<Hex> =>
    signer.sign(receiptStruct(receipt, opts.token));
}

const ANCHOR_ABI = [
  {
    type: "function",
    name: "anchorReceipt",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "receiptId", type: "bytes32" },
          { name: "parentId", type: "bytes32" },
          { name: "payer", type: "address" },
          { name: "payee", type: "address" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "toolId", type: "bytes32" },
        ],
      },
      { name: "payerSignature", type: "bytes" },
      { name: "payeeSignature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isCosigned",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface ReceiptAnchorOptions {
  privateKey: Hex;
  registry: Address;
  token: Address;
  rpcUrl?: string;
  /** wei; GOAT enforces a minimum priority fee (~130000). */
  priorityGasPrice?: bigint;
  maxGasPrice?: bigint;
}

/**
 * Anchor a co-signed receipt on-chain. Permissionless by design — the signatures are the
 * authorization, so a relayer, the buyer, or the seller may all submit, and none of them can
 * change what was signed.
 */
export function createReceiptAnchor(opts: ReceiptAnchorOptions) {
  const wallet = goatWalletClient(opts.privateKey, { rpcUrl: opts.rpcUrl });
  const pub = goatPublicClient({ rpcUrl: opts.rpcUrl });
  const gas = {
    maxPriorityFeePerGas: opts.priorityGasPrice ?? 200_000n,
    maxFeePerGas: opts.maxGasPrice ?? 1_000_000n,
  };

  return async (receipt: Receipt): Promise<{ txHash: Hex }> => {
    if (!receipt.payerSignature || !receipt.payeeSignature) {
      throw new Error(
        `receipt ${receipt.paymentId} is not co-signed; only co-signed receipts are evidence ` +
          "(pass signReceipt on the client and cosign on the gateway)",
      );
    }
    const hash = await wallet.writeContract({
      address: opts.registry,
      abi: ANCHOR_ABI,
      functionName: "anchorReceipt",
      args: [
        receiptStruct(receipt, opts.token),
        receipt.payerSignature as Hex,
        receipt.payeeSignature as Hex,
      ],
      ...gas,
    });
    await pub.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  };
}

/** True once a receipt is anchored with both signatures — i.e. usable as dispute evidence. */
export async function isReceiptCosigned(
  registry: Address,
  receiptId: string,
  opts?: { rpcUrl?: string },
): Promise<boolean> {
  const pub = goatPublicClient({ rpcUrl: opts?.rpcUrl });
  return pub.readContract({
    address: registry,
    abi: ANCHOR_ABI,
    functionName: "isCosigned",
    args: [asBytes32(receiptId)],
  });
}
