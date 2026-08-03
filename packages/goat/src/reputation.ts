import { type Address, type Hex, keccak256, toHex } from "viem";
import { goatPublicClient, goatWalletClient } from "./clients.js";
import { asBytes32, toolId } from "./receipts.js";

const SCORER_ABI = [
  {
    type: "function",
    name: "scoreOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "scoreOfTool",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "scoreOfSeller",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "recordSuccess",
    stateMutability: "nonpayable",
    inputs: [
      { name: "toolId", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "volume", type: "uint256" },
      { name: "newPayer", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "recordDispute",
    stateMutability: "nonpayable",
    inputs: [{ name: "toolId", type: "bytes32" }, { name: "seller", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "recordSlash",
    stateMutability: "nonpayable",
    inputs: [{ name: "toolId", type: "bytes32" }, { name: "seller", type: "address" }],
    outputs: [],
  },
] as const;

/** Read an operator's on-chain reputation score (free view call). */
export async function readScore(
  scorer: Address,
  subject: Address,
  opts?: { rpcUrl?: string },
): Promise<bigint> {
  const pub = goatPublicClient({ rpcUrl: opts?.rpcUrl });
  return pub.readContract({ address: scorer, abi: SCORER_ABI, functionName: "scoreOf", args: [subject] });
}

/**
 * Read a tool's bond-capped score — the number a buyer agent or the reverse auction should
 * actually rank by. Reputation a tool has not collateralized does not count, which is what makes
 * wash-trading and fresh-address Sybils pointless on a chain where gas is nearly free.
 */
export async function readToolScore(
  scorer: Address,
  tool: string,
  opts?: { rpcUrl?: string },
): Promise<bigint> {
  const pub = goatPublicClient({ rpcUrl: opts?.rpcUrl });
  return pub.readContract({
    address: scorer,
    abi: SCORER_ABI,
    functionName: "scoreOfTool",
    args: [toolId(tool)],
  });
}

/**
 * Write settlement outcomes into `ReputationScorer`. Wire this into the gateway so the score the
 * buyer agent reads is built from real settled calls — it used to have no writer at all, which
 * left `scoreOf` permanently zero in production while the demo ranked tools off a hardcoded
 * table.
 *
 * `volume` is in the payment token's MINOR units, matching `ReputationScorer.volumeDivisor`.
 * Reporters must only report outcomes backed by a co-signed receipt.
 */
export function createScoreReporter(opts: {
  privateKey: Hex;
  scorer: Address;
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
  const seenPayers = new Set<string>();

  async function send(hash: Hex): Promise<{ txHash: Hex }> {
    await pub.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  return {
    /**
     * @param volume settled amount in the payment token's MINOR units, matching
     *   `ReputationScorer.volumeDivisor`. Only report outcomes backed by a co-signed receipt.
     */
    async recordSuccess(a: { tool: string; seller: Address; volume: bigint; payer: string }) {
      // `newPayer` drives the unique-payer term. Tracked per process, so a restarted gateway may
      // re-count a payer once; the bond cap bounds what that can be worth either way.
      const key = `${a.tool}:${a.payer.toLowerCase()}`;
      const newPayer = !seenPayers.has(key);
      seenPayers.add(key);
      return send(
        await wallet.writeContract({
          address: opts.scorer,
          abi: SCORER_ABI,
          functionName: "recordSuccess",
          args: [toolId(a.tool), a.seller, a.volume, newPayer],
          ...gas,
        }),
      );
    },
    async recordDispute(a: { tool: string; seller: Address }) {
      return send(
        await wallet.writeContract({
          address: opts.scorer,
          abi: SCORER_ABI,
          functionName: "recordDispute",
          args: [toolId(a.tool), a.seller],
          ...gas,
        }),
      );
    },
    async recordSlash(a: { tool: string; seller: Address }) {
      return send(
        await wallet.writeContract({
          address: opts.scorer,
          abi: SCORER_ABI,
          functionName: "recordSlash",
          args: [toolId(a.tool), a.seller],
          ...gas,
        }),
      );
    },
  };
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
      { name: "receiptId", type: "bytes32" },
      { name: "escrowId", type: "uint256" },
      { name: "slashAmount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * Open an on-chain dispute against a bad paid call. A buyer-favorable ruling refunds the escrow
 * (if there is one) and slashes the tool's bond to the buyer.
 *
 * The caller IS the buyer — the arbiter derives the counterparty and the tool from the evidence
 * rather than trusting parameters. Two ways to prove harm:
 *
 *   - `receiptId` of a **co-signed** receipt. This is the instant-settle path: the money is
 *     already gone, so recourse comes from the seller's bond. Passing a receipt the gateway
 *     wrote unilaterally will revert — only a receipt both parties signed is evidence.
 *   - `escrowId` of an escrow the caller funded and that is still held (the insured path).
 *
 * The slash is capped on-chain at `min(provenHarm, liveBond)`, and each piece of evidence can
 * back exactly one dispute.
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
    /** Receipt id of the disputed call (must be anchored co-signed). */
    receiptId?: string;
    /** Held escrow funded by the caller, if this call was escrowed. */
    escrowId?: bigint;
    /** Bond amount to slash, in the payment token's minor units. */
    slashAmount?: bigint;
  }): Promise<{ txHash: string }> => {
    if (!args.receiptId && !args.escrowId) {
      throw new Error("a dispute needs provable harm: pass a co-signed receiptId and/or an escrowId");
    }
    const hash = await wallet.writeContract({
      address: opts.arbiter,
      abi: DISPUTE_ABI,
      functionName: "openDispute",
      args: [asBytes32(args.receiptId), args.escrowId ?? 0n, args.slashAmount ?? 0n],
      maxPriorityFeePerGas: opts.priorityGasPrice ?? 200000n,
      maxFeePerGas: opts.maxGasPrice ?? 1000000n,
    });
    await pub.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  };
}
