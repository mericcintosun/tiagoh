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
      return { txHash: hash, payee };
    };
    // Serialize: each settle waits for the previous tx to be mined (nonce safety).
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  };
}

export interface FacilitatorSettleOptions {
  /** Hosted GOAT x402 facilitator endpoint (verify + settle). */
  facilitatorUrl: string;
  /** ERC-3009 / Permit2 payment token the facilitator settles. */
  token: Address;
  privateKey: Hex;
  receiptRegistry?: Address;
  rpcUrl?: string;
}

/**
 * PREPARED — the real settlement path, awaiting GOAT x402 Integration Faucet access
 * (payment token + facilitator endpoint). Instead of anchoring a receipt from a mock
 * signature, this verifies the buyer's signed ERC-3009 / Permit2 authorization and
 * settles it through the hosted GOAT facilitator using @goatnetwork/agentkit's x402
 * adapters (HttpMerchantGatewayAdapter + submitSignatureAction), then anchors the
 * receipt. Swap `createOnchainSettle` for this once the faucet is granted — the gateway
 * `SettleFn` shape is unchanged, so nothing else moves.
 */
export function createFacilitatorSettle(_opts: FacilitatorSettleOptions): never {
  throw new Error(
    "createFacilitatorSettle: awaiting GOAT x402 facilitator access (x402 Integration Faucet). " +
      "Wire @goatnetwork/agentkit HttpMerchantGatewayAdapter.verify + submitSignatureAction here, " +
      "then anchor via createOnchainSettle's ReceiptRegistry write.",
  );
}
