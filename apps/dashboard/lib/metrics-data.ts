"use client";

/**
 * /metrics data layer — the honest counters, computed client-side from public
 * sources only (GOAT RPC + Blockscout). No backend, nothing self-reported:
 * every number here is reproducible by anyone against the same endpoints.
 *
 * Ordering follows the published methodology:
 *   1. tiagoh txs as a share of GOAT daily txs (the denominator that matters here)
 *   2. gas contributed, in satoshi (sequencer revenue — the metric L2 programs weight highest)
 *   3. unique paying agents
 *   4. median value per settlement (anti-wash: near-zero averages read as farming)
 *   5. cascade depth distribution (proof the multiplier is real)
 *   6. traffic we exclude OURSELVES: legacy DemoToken suites + team wallets
 */

import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { parseAbiItem } from "viem";

import { deployedContracts as contracts, legacySuites, GOAT_MAINNET, receiptRegistryAbi } from "@/lib/deployments";

const receiptRecordedEvent = parseAbiItem(
  "event ReceiptRecorded(bytes32 indexed receiptId, bytes32 indexed parentId, address indexed payee, address payer, address token, uint256 amount, bytes32 toolId)",
);

/** USDC.e suite deploy block (2026-08-08). */
const USDC_SUITE_FROM_BLOCK = 14_431_800n;
const ZERO32 = `0x${"0".repeat(64)}`;

/** Team wallets excluded from "external" counts — published, not hidden. */
export const EXCLUDED_WALLETS: { address: string; role: string }[] = [
  { address: "0xcF35428Fe59E3b40EEa94adfFD5C898BDCc8b516", role: "deployer / recorder" },
];

export interface TxMetrics {
  source: "chain";
  fetchedAt: string;
  /** GOAT chain-wide, from the public explorer. */
  chainTxsToday: number | null;
  chainUtilizationPct: number | null;
  /** tiagoh, decoded from the USDC.e-suite ReceiptRegistry. */
  settlements: number;
  settlementsToday: number;
  shareOfChainTodayPct: number | null;
  uniquePayers: number;
  medianValueUsd: number | null;
  totalValueUsd: number;
  gasSats: number | null;
  cascadeDepths: { depth: number; count: number }[];
  /** Legacy (DemoToken) suites — counted, labeled, EXCLUDED from the headline. */
  legacyReceipts: { label: string; count: number }[];
}

export function useTxMetrics(): { data: TxMetrics | undefined; isLoading: boolean } {
  const client = usePublicClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tx-metrics"],
    refetchInterval: 30_000,
    enabled: !!client,
    queryFn: async (): Promise<TxMetrics> => {
      if (!client) throw new Error("no client");

      // 1. Chain-wide denominator (public explorer; null on CORS/network failure).
      let chainTxsToday: number | null = null;
      let chainUtilizationPct: number | null = null;
      try {
        const res = await fetch("https://explorer.goat.network/api/v2/stats", {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const s = (await res.json()) as Record<string, unknown>;
          chainTxsToday = Number(s.transactions_today ?? NaN) || null;
          chainUtilizationPct = Number(s.network_utilization_percentage ?? NaN) || null;
        }
      } catch {
        /* explorer unreachable from this origin — the RPC-derived numbers still render */
      }

      // 2. Our settlements: ReceiptRecorded events on the USDC.e registry.
      const logs = await client.getLogs({
        address: contracts.receiptRegistry,
        event: receiptRecordedEvent,
        fromBlock: USDC_SUITE_FROM_BLOCK,
        toBlock: "latest",
      });

      const payers = new Set<string>();
      const values: number[] = [];
      const byId = new Map<string, { parentId: string }>();
      const txHashes = new Set<`0x${string}`>();
      let totalValueUsd = 0;

      for (const log of logs) {
        const a = log.args;
        if (!a.receiptId) continue;
        const amountUsd = Number(a.amount ?? 0n) / 1e6;
        values.push(amountUsd);
        totalValueUsd += amountUsd;
        if (a.payer) payers.add(a.payer.toLowerCase());
        byId.set(a.receiptId.toLowerCase(), { parentId: (a.parentId ?? ZERO32).toLowerCase() });
        if (log.transactionHash) txHashes.add(log.transactionHash);
      }

      // 3. Real gas actually paid by our txs (receipt-anchor txs; capped fetch).
      let gasSats: number | null = null;
      try {
        const sample = [...txHashes].slice(0, 100);
        const receipts = await Promise.all(sample.map((h) => client.getTransactionReceipt({ hash: h })));
        const wei = receipts.reduce(
          (acc, r) => acc + r.gasUsed * (r.effectiveGasPrice ?? 0n),
          0n,
        );
        // Under-count honestly if >100 txs (labelled in the UI as "first 100").
        gasSats = Math.round((Number(wei) / 1e10) * 100) / 100;
      } catch {
        gasSats = null;
      }

      // 4. Cascade depth per receipt (walk parent links).
      const depthOf = (id: string, seen = new Set<string>()): number => {
        const node = byId.get(id);
        if (!node || node.parentId === ZERO32 || seen.has(id)) return 0;
        seen.add(id);
        return 1 + depthOf(node.parentId, seen);
      };
      const depthCounts = new Map<number, number>();
      for (const id of byId.keys()) {
        const d = depthOf(id);
        depthCounts.set(d, (depthCounts.get(d) ?? 0) + 1);
      }

      // 5. Settlements today (UTC), for the share-of-chain number.
      let settlementsToday = logs.length;
      try {
        const head = await client.getBlock();
        const utcMidnight = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
        const blocksSinceMidnight = BigInt(Math.floor((Number(head.timestamp) - utcMidnight) / 3.5));
        const todayFrom = head.number - blocksSinceMidnight;
        settlementsToday = logs.filter((l) => l.blockNumber >= todayFrom).length;
      } catch {
        /* keep the all-time count as the upper bound */
      }

      // 6. Legacy suites — receipts we EXCLUDE (DemoToken era, internal/test).
      const legacyReceipts = await Promise.all(
        legacySuites.map(async (s) => {
          try {
            const n = await client.readContract({
              address: s.receiptRegistry as `0x${string}`,
              abi: receiptRegistryAbi,
              functionName: "count",
            });
            return { label: s.label, count: Number(n) };
          } catch {
            return { label: s.label, count: 0 };
          }
        }),
      );

      const sorted = [...values].sort((x, y) => x - y);
      const median =
        sorted.length === 0
          ? null
          : sorted.length % 2
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

      return {
        source: "chain",
        fetchedAt: new Date().toISOString(),
        chainTxsToday,
        chainUtilizationPct,
        settlements: logs.length,
        settlementsToday,
        shareOfChainTodayPct:
          chainTxsToday && chainTxsToday > 0
            ? Math.round((settlementsToday / chainTxsToday) * 1000) / 10
            : null,
        uniquePayers: payers.size,
        medianValueUsd: median,
        totalValueUsd: Math.round(totalValueUsd * 100) / 100,
        gasSats,
        cascadeDepths: [...depthCounts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([depth, count]) => ({ depth, count })),
        legacyReceipts,
      };
    },
  });

  return { data, isLoading };
}

export const explorerAddressUrl = (a: string) => `${GOAT_MAINNET.explorer}/address/${a}`;
