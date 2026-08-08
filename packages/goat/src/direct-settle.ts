import { encodeFunctionData, keccak256, toHex, stringToHex, type Address, type Hex } from "viem";
import { goatWalletClient, goatPublicClient } from "./clients.js";

/**
 * ERC20_DIRECT settlement — GOAT Flow's production model, self-hosted.
 *
 * The buyer pays with a plain ERC-20 `transfer` of the REAL stablecoin (USDC.e on
 * GOAT mainnet), then the receipt is anchored to ReceiptRegistry in a second tx.
 * No mock signing anywhere: money moves on-chain, per call, charge-on-success.
 *
 * Both transactions carry an ERC-8021 builder-code suffix (see below), so every
 * tiagoh settlement is filterable on-chain by anyone — including the GOAT team —
 * without trusting our own reporting.
 */

/**
 * ERC-8021 builder-code calldata suffix.
 * Layout (appended to calldata, parsed backwards from the end):
 *   …originalCalldata | 16-byte marker 0x80218021… | 1-byte schemaId | schemaData
 * Contracts ignore trailing calldata, so execution is unaffected. Until a Code
 * Registry exists on GOAT the tag is purely an attribution WHERE-clause:
 *   calldata endsWith (MARKER + SCHEMA + CODE).
 */
export const ERC8021_MARKER = "0x80218021802180218021802180218021" as const;
const ERC8021_SCHEMA_RAW = "00"; // schema 0: raw bytes code
const BUILDER_CODE = stringToHex("tiagoh").slice(2); // 746961676f68

export function withBuilderCode(data: Hex): Hex {
  return (data + ERC8021_MARKER.slice(2) + ERC8021_SCHEMA_RAW + BUILDER_CODE) as Hex;
}

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const RECORD_RECEIPT_ABI = [
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

export interface DirectSettleOptions {
  /** Buyer key — signs the ERC-20 transfer (the actual payment). */
  buyerPrivateKey: Hex;
  /** Recorder key — anchors the receipt (the gateway/deployer). May equal buyer on dev runs. */
  recorderPrivateKey: Hex;
  /** Payment token (USDC.e on GOAT mainnet), 6 decimals. */
  token: Address;
  /** Seller payout address. MUST NOT be funded by the buyer (wash-pattern hygiene). */
  payTo: Address;
  receiptRegistry: Address;
  rpcUrl?: string;
  priorityGasPrice?: bigint;
  maxGasPrice?: bigint;
}

/**
 * A gateway `SettleFn` where settlement is a REAL on-chain USDC.e transfer followed
 * by a receipt anchor. Serialized like createOnchainSettle so cascade hops never
 * race nonces. Returns the PAYMENT transfer's tx hash (the money-moving tx).
 */
export function createDirectTransferSettle(opts: DirectSettleOptions) {
  const buyer = goatWalletClient(opts.buyerPrivateKey, { rpcUrl: opts.rpcUrl });
  const recorder = goatWalletClient(opts.recorderPrivateKey, { rpcUrl: opts.rpcUrl });
  const pub = goatPublicClient({ rpcUrl: opts.rpcUrl });
  const priority = opts.priorityGasPrice ?? 200000n;
  const maxFee = opts.maxGasPrice ?? 1000000n;

  let queue: Promise<unknown> = Promise.resolve();

  return (args: {
    paymentId: string;
    tool: string;
    /** Payment amount in the token's MINOR units (6 decimals for USDC.e) — matches gateway SettleFn. */
    amount: bigint;
    parentId: string | null;
  }): Promise<{ txHash: string; payee: Address }> => {
    const run = async (): Promise<{ txHash: string; payee: Address }> => {
      const minor = args.amount;

      // 1. The payment: buyer → seller, real stablecoin, ERC-8021-tagged.
      const transferData = withBuilderCode(
        encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [opts.payTo, minor],
        }),
      );
      const payNonce = await pub.getTransactionCount({ address: buyer.account.address, blockTag: "pending" });
      const payHash = await buyer.sendTransaction({
        to: opts.token,
        data: transferData,
        nonce: payNonce,
        maxPriorityFeePerGas: priority,
        maxFeePerGas: maxFee,
      });
      await pub.waitForTransactionReceipt({ hash: payHash });

      // 2. The receipt anchor, linked to its cascade parent, ERC-8021-tagged.
      const receiptData = withBuilderCode(
        encodeFunctionData({
          abi: RECORD_RECEIPT_ABI,
          functionName: "recordReceipt",
          args: [
            b32(args.paymentId),
            args.parentId ? b32(args.parentId) : ZERO32,
            buyer.account.address,
            opts.payTo,
            opts.token,
            minor,
            b32(args.tool),
          ],
        }),
      );
      const recNonce = await pub.getTransactionCount({ address: recorder.account.address, blockTag: "pending" });
      const recHash = await recorder.sendTransaction({
        to: opts.receiptRegistry,
        data: receiptData,
        nonce: recNonce,
        maxPriorityFeePerGas: priority,
        maxFeePerGas: maxFee,
      });
      await pub.waitForTransactionReceipt({ hash: recHash });

      return { txHash: payHash, payee: opts.payTo };
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  };
}
