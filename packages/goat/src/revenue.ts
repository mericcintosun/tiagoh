import { type Address, type Hex } from "viem";
import { goatPublicClient, goatWalletClient } from "./clients.js";

const REVENUE_SPLIT_ABI = [
  {
    type: "function",
    name: "payeeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "payees",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "releasable",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }],
    outputs: [],
  },
] as const;

/**
 * Auto-split accumulated revenue in a RevenueSplit to its payees. `release` is pull-based and
 * per-payee, so this reads the payee set and releases every account with a non-zero due balance,
 * skipping those with nothing owed (so it is safe to call after every settle). Use it as the
 * `postSettle` hook on `createOnchainSettle` when a wrapped tool shares revenue upstream.
 */
export function createRevenueSplitRelease(opts: {
  privateKey: Hex;
  split: Address;
  rpcUrl?: string;
  priorityGasPrice?: bigint;
  maxGasPrice?: bigint;
}) {
  const wallet = goatWalletClient(opts.privateKey, { rpcUrl: opts.rpcUrl });
  const pub = goatPublicClient({ rpcUrl: opts.rpcUrl });
  const gas = {
    maxPriorityFeePerGas: opts.priorityGasPrice ?? 200000n,
    maxFeePerGas: opts.maxGasPrice ?? 1000000n,
  };

  return async (): Promise<{ released: Array<{ payee: Address; amount: bigint; txHash: string }> }> => {
    const count = await pub.readContract({
      address: opts.split,
      abi: REVENUE_SPLIT_ABI,
      functionName: "payeeCount",
    });
    const released: Array<{ payee: Address; amount: bigint; txHash: string }> = [];
    for (let i = 0n; i < count; i++) {
      const payee = await pub.readContract({
        address: opts.split,
        abi: REVENUE_SPLIT_ABI,
        functionName: "payees",
        args: [i],
      });
      const due = await pub.readContract({
        address: opts.split,
        abi: REVENUE_SPLIT_ABI,
        functionName: "releasable",
        args: [payee],
      });
      if (due === 0n) continue; // nothing owed — skip (release would revert)
      const hash = await wallet.writeContract({
        address: opts.split,
        abi: REVENUE_SPLIT_ABI,
        functionName: "release",
        args: [payee],
        ...gas,
      });
      await pub.waitForTransactionReceipt({ hash });
      released.push({ payee, amount: due, txHash: hash });
    }
    return { released };
  };
}
