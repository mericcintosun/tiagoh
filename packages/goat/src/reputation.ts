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

// --- ERC-8004 Reputation Registry --------------------------------------------------------------
// tiagoh writes settlement outcomes as ERC-8004 feedback: a settled call is positive feedback, a
// dispute or a quality-bond slash is negative. The signature matches the canonical ERC-8004 registry,
// so pointing this at the canonical registry (once live on GOAT mainnet) is an address swap.

const ERC8004_ABI = [
  {
    type: "function",
    name: "agentOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "registerAgent",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "getSummary",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "sumWad", type: "int256" },
      { name: "averageWad", type: "int256" },
    ],
  },
] as const;

export type Erc8004Outcome = "success" | "dispute" | "slash";

/** Read an agent's aggregated ERC-8004 reputation summary (free view call). */
export async function readErc8004Summary(
  registry: Address,
  agentId: bigint,
  opts?: { rpcUrl?: string },
): Promise<{ count: bigint; sumWad: bigint; averageWad: bigint }> {
  const pub = goatPublicClient({ rpcUrl: opts?.rpcUrl });
  const [count, sumWad, averageWad] = await pub.readContract({
    address: registry,
    abi: ERC8004_ABI,
    functionName: "getSummary",
    args: [agentId],
  });
  return { count, sumWad, averageWad };
}

/**
 * Write settlement outcomes to the ERC-8004 Reputation Registry (on-chain). Each settled paid call
 * becomes ERC-8004 feedback, tagged by outcome and anchored to its receipt hash, so reputation is
 * built from settlement facts. `giveFeedback` registers the subject's agent id on first use.
 */
export function createOnchainReputation(opts: {
  privateKey: Hex;
  registry: Address;
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

  /** Return the subject's agent id, registering it on first use. */
  async function ensureAgent(subject: Address): Promise<bigint> {
    const existing = await pub.readContract({
      address: opts.registry,
      abi: ERC8004_ABI,
      functionName: "agentOf",
      args: [subject],
    });
    if (existing !== 0n) return existing;
    const hash = await wallet.writeContract({
      address: opts.registry,
      abi: ERC8004_ABI,
      functionName: "registerAgent",
      args: [subject],
      ...gas,
    });
    await pub.waitForTransactionReceipt({ hash });
    return pub.readContract({
      address: opts.registry,
      abi: ERC8004_ABI,
      functionName: "agentOf",
      args: [subject],
    });
  }

  /** Write one feedback entry about a subject. Positive for success, negative otherwise. */
  async function giveFeedback(args: {
    subject: Address;
    outcome: Erc8004Outcome;
    endpoint?: string;
    receiptId?: string;
    /** Override the default score (+100 success / -100 otherwise), whole-number scale. */
    value?: number;
  }): Promise<{ txHash: string; agentId: bigint }> {
    const agentId = await ensureAgent(args.subject);
    const value = BigInt(args.value ?? (args.outcome === "success" ? 100 : -100));
    const feedbackHash = args.receiptId ? keccak256(toHex(args.receiptId)) : (`0x${"0".repeat(64)}` as Hex);
    const hash = await wallet.writeContract({
      address: opts.registry,
      abi: ERC8004_ABI,
      functionName: "giveFeedback",
      args: [agentId, value, 0, "tiagoh", args.outcome, args.endpoint ?? "", args.receiptId ?? "", feedbackHash],
      ...gas,
    });
    await pub.waitForTransactionReceipt({ hash });
    return { txHash: hash, agentId };
  }

  return { ensureAgent, giveFeedback };
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
