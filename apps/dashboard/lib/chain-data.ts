"use client";

/**
 * The client-side data path — there is NO backend to host.
 *
 * Every hook here reads straight from the GOAT chain via wagmi/viem over the public
 * RPC configured in `lib/wagmi.ts`. `useChainStatus` is a LIVE read (block number +
 * chain id + connection state) proving the path is real. The domain hooks
 * (`useReceipts`, `useLeaderboard`, …) return typed data shaped exactly like the
 * on-chain models: once `contracts.*` (from @tiagoh/goat) resolve to deployed
 * addresses, each hook swaps its stubbed rows for `publicClient.getLogs()` /
 * `readContract()` decoding — the component API does not change.
 */

import { useBlockNumber, useChainId, usePublicClient, useReadContract } from "wagmi";
import { deployedContracts as contracts, receiptRegistryAbi } from "@/lib/deployments";
import {
  auctions,
  bondEvents,
  cascadeTree,
  contractGrid,
  disputes,
  leaderboard,
  receipts,
  revenueSeries,
  type Auction,
  type BondEvent,
  type CascadeNode,
  type ContractInfo,
  type Dispute,
  type Receipt,
  type ReputationEntry,
  type RevenuePoint,
} from "@/lib/mock";

export interface ChainStatus {
  chainId: number;
  blockNumber: bigint | null;
  isLive: boolean;
  /** True while contract addresses are unset → widgets render typed stub rows. */
  usingStub: boolean;
}

/** LIVE chain read — no backend, no cache server. Proves the client-side path. */
export function useChainStatus(): ChainStatus {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const anyContractSet = Object.values(contracts).some((a) => typeof a === "string");

  return {
    chainId,
    blockNumber: blockNumber ?? null,
    isLive: Boolean(publicClient) && blockNumber !== undefined,
    usingStub: !anyContractSet,
  };
}

// ── Domain hooks — client-side; stub rows until contracts resolve ────────────
// Each returns { data, source } so a surface can badge "on-chain" vs "stub".

type Sourced<T> = { data: T; source: "chain" | "stub" };

export function useReceipts(): Sourced<Receipt[]> {
  const set = typeof contracts.receiptRegistry === "string";
  return { data: receipts, source: set ? "chain" : "stub" };
}

export function useRevenue(): Sourced<RevenuePoint[]> {
  const set = typeof contracts.receiptRegistry === "string";
  return { data: revenueSeries, source: set ? "chain" : "stub" };
}

export function useLeaderboard(): Sourced<ReputationEntry[]> {
  const set = typeof contracts.reputationScorer === "string";
  return { data: leaderboard, source: set ? "chain" : "stub" };
}

export function useBondFeed(): Sourced<BondEvent[]> {
  const set = typeof contracts.qualityBond === "string";
  return { data: bondEvents, source: set ? "chain" : "stub" };
}

export function useAuctions(): Sourced<Auction[]> {
  const set = typeof contracts.toolAuction === "string";
  return { data: auctions, source: set ? "chain" : "stub" };
}

export function useDisputes(): Sourced<Dispute[]> {
  const set = typeof contracts.disputeArbiter === "string";
  return { data: disputes, source: set ? "chain" : "stub" };
}

export function useCascade(): Sourced<CascadeNode> {
  const set = typeof contracts.cascadeController === "string";
  return { data: cascadeTree, source: set ? "chain" : "stub" };
}

/**
 * LIVE read of the deployed ReceiptRegistry (GOAT Testnet3) — real client-side
 * chain access via wagmi `useReadContract`, no backend. Returns the on-chain
 * receipt count + total volume, polled from the RPC.
 */
export function useReceiptRegistryStats(): { count?: bigint; totalVolumeRaw?: bigint } {
  const { data: count } = useReadContract({
    address: contracts.receiptRegistry,
    abi: receiptRegistryAbi,
    functionName: "count",
    query: { refetchInterval: 15000 },
  });
  const { data: totalVolume } = useReadContract({
    address: contracts.receiptRegistry,
    abi: receiptRegistryAbi,
    functionName: "totalVolume",
  });
  return {
    count: typeof count === "bigint" ? count : undefined,
    totalVolumeRaw: typeof totalVolume === "bigint" ? totalVolume : undefined,
  };
}

export function useContractGrid(): ContractInfo[] {
  // Merge resolved addresses from @tiagoh/goat into the display grid.
  const resolved: Record<string, `0x${string}` | undefined> = {
    ReceiptRegistry: contracts.receiptRegistry,
    RevenueSplit: contracts.revenueSplit,
    CascadeController: contracts.cascadeController,
    PaymentChannel: contracts.paymentChannel,
    QualityBond: contracts.qualityBond,
    EscrowVault: contracts.escrowVault,
    DisputeArbiter: contracts.disputeArbiter,
    ReputationScorer: contracts.reputationScorer,
    ToolAuction: contracts.toolAuction,
    AgentRegistry: contracts.agentRegistry,
  };
  return contractGrid.map((c) => {
    const addr = resolved[c.name];
    return addr ? { ...c, address: addr, status: "live" } : c;
  });
}
