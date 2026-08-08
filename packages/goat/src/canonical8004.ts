import { decodeEventLog, keccak256, toHex, type Address, type Hex } from "viem";
import { goatPublicClient, goatWalletClient } from "./clients.js";

/**
 * CANONICAL ERC-8004 on GOAT mainnet — replaces tiagoh's private registry fork.
 *
 * All three canonical registries are live on GOAT (ERC1967 proxies, deployed
 * 2026-02-12, owner = the official 8004 team key). The fork's `giveFeedback`
 * ABI is byte-identical to the canonical one (verified against the explorer's
 * published implementation ABI), so feedback writes are an address swap. What
 * is NOT an address swap is registration: canonical agents are ERC-721 tokens
 * minted on the Identity registry via `register(string agentURI)` — the fork's
 * `registerAgent(address)` does not exist there.
 */
export const CANONICAL_ERC8004 = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
  /** Deployed on GOAT with ZERO usage; implementation source unverified — probe before writing. */
  validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58" as Address,
} as const;

const IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

/** Same 8-arg signature as the retired fork — verified identical on the canonical implementation. */
const REPUTATION_ABI = [
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
] as const;

export interface Canonical8004Options {
  privateKey: Hex;
  rpcUrl?: string;
  priorityGasPrice?: bigint;
  maxGasPrice?: bigint;
  identity?: Address;
  reputation?: Address;
}

/**
 * Canonical ERC-8004 writer. Register once (`register` returns the ERC-721 agentId —
 * persist it, e.g. TIAGOH_CANONICAL_AGENT_ID), then write settlement outcomes as
 * feedback with `giveFeedback`, anchored to the receipt that proves them.
 */
export function createCanonical8004(opts: Canonical8004Options) {
  const wallet = goatWalletClient(opts.privateKey, { rpcUrl: opts.rpcUrl });
  const pub = goatPublicClient({ rpcUrl: opts.rpcUrl });
  const identity = opts.identity ?? CANONICAL_ERC8004.identity;
  const reputation = opts.reputation ?? CANONICAL_ERC8004.reputation;
  const gas = {
    maxPriorityFeePerGas: opts.priorityGasPrice ?? 200000n,
    maxFeePerGas: opts.maxGasPrice ?? 1000000n,
  };

  return {
    /** How many canonical agents this wallet already owns (0 → not registered yet). */
    async agentCount(): Promise<bigint> {
      return pub.readContract({
        address: identity,
        abi: IDENTITY_ABI,
        functionName: "balanceOf",
        args: [wallet.account.address],
      });
    },

    /**
     * Mint this wallet's canonical agent identity. Returns the agentId parsed from the
     * ERC-721 Transfer event. Call once and persist the id.
     */
    async register(agentURI: string): Promise<{ agentId: bigint; txHash: Hex }> {
      const hash = await wallet.writeContract({
        address: identity,
        abi: IDENTITY_ABI,
        functionName: "register",
        args: [agentURI],
        ...gas,
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: IDENTITY_ABI, data: log.data, topics: log.topics });
          if (ev.eventName === "Transfer") return { agentId: ev.args.tokenId, txHash: hash };
        } catch {
          /* not the Transfer event — keep scanning */
        }
      }
      throw new Error("register succeeded but no Transfer event found (proxy ABI drift?)");
    },

    /** Write one settlement outcome as canonical feedback, anchored to its receipt. */
    async giveFeedback(args: {
      agentId: bigint;
      outcome: "success" | "dispute" | "slash";
      endpoint?: string;
      receiptId?: string;
      value?: number;
    }): Promise<{ txHash: Hex }> {
      const value = BigInt(args.value ?? (args.outcome === "success" ? 100 : -100));
      const feedbackHash = args.receiptId
        ? keccak256(toHex(args.receiptId))
        : (`0x${"0".repeat(64)}` as Hex);
      const hash = await wallet.writeContract({
        address: reputation,
        abi: REPUTATION_ABI,
        functionName: "giveFeedback",
        args: [
          args.agentId,
          value,
          0,
          "tiagoh",
          args.outcome,
          args.endpoint ?? "",
          args.receiptId ?? "",
          feedbackHash,
        ],
        ...gas,
      });
      await pub.waitForTransactionReceipt({ hash });
      return { txHash: hash };
    },
  };
}

/**
 * Validation Registry scaffold. The canonical proxy is deployed on GOAT with zero
 * usage and an UNVERIFIED implementation, so this only probes for code — it refuses
 * to guess a write ABI. First production integration lands once the implementation
 * source is published (tracked in TX-WEEK-PLAN.md / GOAT-FINDINGS.md §5).
 */
export async function probeValidationRegistry(opts?: { rpcUrl?: string }): Promise<{
  address: Address;
  hasCode: boolean;
}> {
  const pub = goatPublicClient({ rpcUrl: opts?.rpcUrl });
  const code = await pub.getCode({ address: CANONICAL_ERC8004.validation });
  return { address: CANONICAL_ERC8004.validation, hasCode: !!code && code !== "0x" };
}
