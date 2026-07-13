import { type Address, type Hex, keccak256, toHex } from "viem";
import { goatPublicClient, goatWalletClient } from "./clients.js";

const SCORER_ABI = [
  {
    type: "function",
    name: "scoreOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Read a subject's on-chain reputation score (free view call). */
export async function readScore(
  scorer: Address,
  subject: Address,
  opts?: { rpcUrl?: string },
): Promise<bigint> {
  const pub = goatPublicClient({ rpcUrl: opts?.rpcUrl });
  return pub.readContract({ address: scorer, abi: SCORER_ABI, functionName: "scoreOf", args: [subject] });
}

const DISPUTE_ABI = [
  {
    type: "function",
    name: "openDispute",
    stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Open an on-chain dispute (write) against a bad paid call — a buyer-favorable ruling
 * refunds the escrow and slashes the tool's bond to the buyer. Built and ready; the
 * demos default to an off-chain dispute callback so they don't spend gas.
 */
export function createOnchainDispute(opts: {
  privateKey: Hex;
  arbiter: Address;
  rpcUrl?: string;
  priorityGasPrice?: bigint;
  maxGasPrice?: bigint;
}) {
  const wallet = goatWalletClient(opts.privateKey, { rpcUrl: opts.rpcUrl });
  const pub = goatPublicClient({ rpcUrl: opts.rpcUrl });
  return async (args: {
    subject: string;
    buyer: Address;
    seller: Address;
    toolId: string;
    escrowId?: bigint;
    slashAmount?: bigint;
  }): Promise<{ txHash: string }> => {
    const hash = await wallet.writeContract({
      address: opts.arbiter,
      abi: DISPUTE_ABI,
      functionName: "openDispute",
      args: [
        keccak256(toHex(args.subject)),
        args.buyer,
        args.seller,
        keccak256(toHex(args.toolId)),
        args.escrowId ?? 0n,
        args.slashAmount ?? 0n,
      ],
      maxPriorityFeePerGas: opts.priorityGasPrice ?? 200000n,
      maxFeePerGas: opts.maxGasPrice ?? 1000000n,
    });
    await pub.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  };
}
