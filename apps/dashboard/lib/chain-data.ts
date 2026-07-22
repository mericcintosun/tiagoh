"use client";

/**
 * The client-side data path — there is NO backend to host.
 *
 * Every hook here reads straight from the GOAT chain via wagmi/viem over the public
 * RPC configured in `lib/wagmi.ts`. `useChainStatus` is a LIVE read (block number +
 * chain id + connection state) proving the path is real. The domain hooks
 * (`useReceipts`, `useLeaderboard`, …) decode the deployed contracts on GOAT
 * mainnet (chainId 2345): `publicClient.getLogs()` for events + `readContract()`
 * for view calls, wrapped in react-query with a ~15s refetch. Each hook returns real
 * on-chain rows with `source: "chain"` and falls back to the typed stub (or an empty
 * array) on any read error / empty result so the UI never throws in render.
 */

import { useBlockNumber, useChainId, usePublicClient, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { keccak256, toHex, parseAbiItem, type Address } from "viem";

import { deployedContracts as contracts, receiptRegistryAbi } from "@/lib/deployments";
import { shortHash } from "@/lib/format";
import {
  auctions as auctionsStub,
  bondEvents as bondEventsStub,
  cascadeTree as cascadeStub,
  contractGrid,
  disputes as disputesStub,
  leaderboard as leaderboardStub,
  receipts as receiptsStub,
  revenueSeries as revenueStub,
  type Auction,
  type AuctionBid,
  type BondEvent,
  type CascadeNode,
  type ContractInfo,
  type Dispute,
  type Receipt,
  type ReputationEntry,
  type RevenuePoint,
} from "@/lib/mock";

// ── On-chain constants ───────────────────────────────────────────────────────

/** Contracts deployed ~block 14,017,600 on GOAT mainnet; query from just below to dodge RPC range caps. */
const FROM_BLOCK = 14_017_000n;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;
const ZERO_HASH = ZERO_BYTES32 as `0x${string}`;
const POLL = 15_000;

/**
 * QualityBond deployment the bond feed reads. On mainnet this is the live QualityBond
 * (bonds appear here once sellers stake); with no live bonds the feed falls back to
 * typed stub rows.
 */
const QUALITY_BOND_EXERCISED = "0x0b592E60706695Dc1E84bFda4f2ec59dc660e980" as Address;

/** Reverse map for the demo tool ids: toolId = keccak256(toHex(name)) (see @tiagoh/goat settle). */
const TOOL_NAMES = [
  "get_rwa_price",
  "analyze_portfolio",
  "get_goat_market_data",
  "get_defi_yields",
  "flaky_tool",
] as const;
const TOOL_BY_ID: Record<string, string> = Object.fromEntries(
  TOOL_NAMES.map((n) => [keccak256(toHex(n)).toLowerCase(), n]),
);

function toolName(toolId: string): string {
  return TOOL_BY_ID[toolId.toLowerCase()] ?? shortHash(toolId, 6, 4);
}
function toolHandle(toolId: string): string {
  const n = TOOL_BY_ID[toolId.toLowerCase()];
  return n ? `${n}.goat` : shortHash(toolId, 6, 4);
}
function addrHandle(a: string): string {
  return shortHash(a, 6, 4);
}
/** On-chain receipt/bond/auction amounts are stored in cents (round(usd * 100)). */
function centsToUsd(v: bigint): number {
  return Number(v) / 100;
}
/** Consistent short id so the cascade graph links child.parentId → parent.callId. */
function shortId(hex: string): string {
  return hex.slice(0, 10);
}

// ── Event signatures (decoded via viem getLogs) ──────────────────────────────

const receiptRecordedEvent = parseAbiItem(
  "event ReceiptRecorded(bytes32 indexed receiptId, bytes32 indexed parentId, address indexed payee, address payer, address token, uint256 amount, bytes32 toolId)",
);
const bondedEvent = parseAbiItem(
  "event Bonded(bytes32 indexed toolId, address indexed seller, uint8 tier, uint256 amount)",
);
const slashedEvent = parseAbiItem(
  "event Slashed(bytes32 indexed toolId, address indexed to, uint256 amount, uint256 remaining)",
);
const disputeOpenedEvent = parseAbiItem(
  "event DisputeOpened(uint256 indexed disputeId, bytes32 indexed subject, address indexed buyer, address seller, bytes32 toolId)",
);
const disputeRuledEvent = parseAbiItem(
  "event DisputeRuled(uint256 indexed disputeId, bool forBuyer)",
);

// ── View-call ABIs ───────────────────────────────────────────────────────────

const scorerAbi = [
  {
    type: "function",
    name: "scoreOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const auctionAbi = [
  { type: "function", name: "requestCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "requests",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "capabilityId", type: "bytes32" },
      { name: "maxPrice", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "policy", type: "uint8" },
      { name: "open", type: "bool" },
      { name: "settled", type: "bool" },
      { name: "winner", type: "address" },
      { name: "winningPrice", type: "uint256" },
    ],
  },
  { type: "function", name: "bidCount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "bids",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [
      { name: "bidder", type: "address" },
      { name: "price", type: "uint256" },
    ],
  },
] as const;

const disputeAbi = [
  { type: "function", name: "disputeCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "disputes",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "subject", type: "bytes32" },
      { name: "buyer", type: "address" },
      { name: "seller", type: "address" },
      { name: "toolId", type: "bytes32" },
      { name: "escrowId", type: "uint256" },
      { name: "slashAmount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "forBuyer", type: "bool" },
    ],
  },
] as const;

// ── Shared read helpers ──────────────────────────────────────────────────────

type ViemClient = NonNullable<ReturnType<typeof usePublicClient>>;

/**
 * Run a getLogs against the wide deploy-anchored window; if the public RPC rejects the
 * range, retry with progressively smaller windows anchored at the head. Never throws.
 */
async function withBlockFallback<T>(
  client: ViemClient,
  run: (fromBlock: bigint) => Promise<T[]>,
): Promise<T[]> {
  try {
    return await run(FROM_BLOCK);
  } catch {
    try {
      const latest = await client.getBlockNumber();
      for (const span of [500_000n, 100_000n, 20_000n, 5_000n]) {
        const from = latest > span ? latest - span : 0n;
        try {
          return await run(from);
        } catch {
          /* try a smaller window */
        }
      }
    } catch {
      /* ignore */
    }
    return [];
  }
}

/** Map a set of block numbers → ms timestamps (batched, deduped, error-tolerant). */
async function blockTimestamps(
  client: ViemClient,
  blockNumbers: Array<bigint | null | undefined>,
): Promise<Map<string, number>> {
  const uniq = [...new Set(blockNumbers.filter((b): b is bigint => typeof b === "bigint").map(String))];
  const entries = await Promise.all(
    uniq.map(async (key) => {
      try {
        const block = await client.getBlock({ blockNumber: BigInt(key) });
        return [key, Number(block.timestamp) * 1000] as const;
      } catch {
        return [key, Date.now()] as const;
      }
    }),
  );
  return new Map(entries);
}

// ── Internal: decoded receipts (shared by receipts / revenue / cascade / rep) ─

interface DecodedReceipt {
  receiptId: `0x${string}`;
  parentId: `0x${string}`;
  payer: string;
  payee: string;
  token: string;
  amount: bigint;
  toolId: `0x${string}`;
  blockNumber: bigint;
  txHash: `0x${string}`;
  ts: number;
}

async function fetchReceiptLogs(client: ViemClient): Promise<DecodedReceipt[]> {
  const logs = await withBlockFallback(client, (fromBlock) =>
    client.getLogs({
      address: contracts.receiptRegistry,
      event: receiptRecordedEvent,
      fromBlock,
      toBlock: "latest",
    }),
  );
  const times = await blockTimestamps(client, logs.map((l) => l.blockNumber));
  return logs
    .map((l) => {
      const a = l.args;
      return {
        receiptId: (a.receiptId ?? ZERO_HASH) as `0x${string}`,
        parentId: (a.parentId ?? ZERO_HASH) as `0x${string}`,
        payer: (a.payer ?? "") as string,
        payee: (a.payee ?? "") as string,
        token: (a.token ?? "") as string,
        amount: a.amount ?? 0n,
        toolId: (a.toolId ?? ZERO_HASH) as `0x${string}`,
        blockNumber: l.blockNumber ?? 0n,
        txHash: (l.transactionHash ?? ZERO_HASH) as `0x${string}`,
        ts: times.get((l.blockNumber ?? 0n).toString()) ?? Date.now(),
      };
    })
    .sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1));
}

function useReceiptLogs() {
  const publicClient = usePublicClient();
  return useQuery({
    queryKey: ["tiagoh", "receipt-logs"],
    enabled: Boolean(publicClient),
    refetchInterval: POLL,
    queryFn: () => fetchReceiptLogs(publicClient as ViemClient),
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

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

// ── Domain hooks — client-side; real chain rows with stub fallback ───────────
// Each returns { data, source } so a surface can badge "on-chain" vs "stub".

type Sourced<T> = { data: T; source: "chain" | "stub" };

/** Receipts decoded from ReceiptRegistry `ReceiptRecorded` logs. */
export function useReceipts(): Sourced<Receipt[]> {
  const { data } = useReceiptLogs();

  if (data && data.length > 0) {
    const rows: Receipt[] = data.map((r, i) => ({
      id: `${r.receiptId}-${i}`,
      tool: toolName(r.toolId),
      handle: toolHandle(r.toolId),
      callId: shortId(r.receiptId),
      parentId: r.parentId === ZERO_BYTES32 ? null : shortId(r.parentId),
      amountUsd: centsToUsd(r.amount),
      status: "settled",
      txHash: r.txHash,
      payer: addrHandle(r.payer),
      ts: r.ts,
    }));
    return { data: rows, source: "chain" };
  }
  return { data: receiptsStub, source: "stub" };
}

/** Volume-over-time derived from receipt logs, bucketed per day. */
export function useRevenue(): Sourced<RevenuePoint[]> {
  const { data } = useReceiptLogs();

  if (data && data.length > 0) {
    const byDay = new Map<string, { date: string; revenueUsd: number; calls: number; sort: number }>();
    for (const r of data) {
      const d = new Date(r.ts);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const label = d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
      const bucket = byDay.get(dayKey) ?? { date: label, revenueUsd: 0, calls: 0, sort: d.getTime() };
      bucket.revenueUsd += centsToUsd(r.amount);
      bucket.calls += 1;
      byDay.set(dayKey, bucket);
    }
    const points = [...byDay.values()]
      .sort((a, b) => a.sort - b.sort)
      .map(({ date, revenueUsd, calls }) => ({ date, revenueUsd: Math.round(revenueUsd * 100) / 100, calls }));
    if (points.length > 0) return { data: points, source: "chain" };
  }
  return { data: revenueStub, source: "stub" };
}

/**
 * Reputation leaderboard driven by receipts: group by toolId → settled calls + volume +
 * unique payers, overlaid with `ReputationScorer.scoreOf(payee)` where the on-chain score
 * is set (falls back to a transparent receipt-derived proxy so the ranking is populated).
 */
export function useLeaderboard(): Sourced<ReputationEntry[]> {
  const publicClient = usePublicClient();
  const { data } = useQuery({
    queryKey: ["tiagoh", "leaderboard"],
    enabled: Boolean(publicClient),
    refetchInterval: POLL,
    queryFn: async (): Promise<ReputationEntry[]> => {
      const client = publicClient as ViemClient;
      const rows = await fetchReceiptLogs(client);
      if (rows.length === 0) return [];

      const groups = new Map<
        string,
        { toolId: string; calls: number; volumeUsd: number; payers: Set<string>; payee: string }
      >();
      for (const r of rows) {
        const key = r.toolId.toLowerCase();
        const g = groups.get(key) ?? { toolId: r.toolId, calls: 0, volumeUsd: 0, payers: new Set<string>(), payee: r.payee };
        g.calls += 1;
        g.volumeUsd += centsToUsd(r.amount);
        g.payers.add(r.payer.toLowerCase());
        groups.set(key, g);
      }

      // Overlay on-chain reputation score for each group's payee (subject).
      const payees = [...new Set([...groups.values()].map((g) => g.payee))];
      const scoreByPayee = new Map<string, number>();
      await Promise.all(
        payees.map(async (p) => {
          try {
            const s = await client.readContract({
              address: contracts.reputationScorer,
              abi: scorerAbi,
              functionName: "scoreOf",
              args: [p as Address],
            });
            scoreByPayee.set(p, Number(s));
          } catch {
            scoreByPayee.set(p, 0);
          }
        }),
      );

      const entries = [...groups.values()].map((g) => {
        const onchain = scoreByPayee.get(g.payee) ?? 0;
        // Receipt-derived proxy when the aggregate on-chain score is unset (0).
        const derived = Math.min(1000, 640 + g.calls * 45 + Math.round(g.volumeUsd));
        const score = onchain > 0 ? Math.min(1000, onchain) : derived;
        return {
          tool: toolName(g.toolId),
          handle: toolHandle(g.toolId),
          score,
          successRate: 100,
          volume: g.calls,
          disputes: 0,
          slashes: 0,
          bondUsd: 0,
          uniquePayers: g.payers.size,
          trend: (g.calls > 1 ? "up" : "flat") as ReputationEntry["trend"],
        };
      });

      entries.sort((a, b) => b.score - a.score || b.volume - a.volume);
      return entries.map((e, i) => ({ ...e, rank: i + 1 }));
    },
  });

  if (data && data.length > 0) return { data, source: "chain" };
  return { data: leaderboardStub, source: "stub" };
}

/** Bond / slash feed decoded from the exercised QualityBond instance. */
export function useBondFeed(): Sourced<BondEvent[]> {
  const publicClient = usePublicClient();
  const { data } = useQuery({
    queryKey: ["tiagoh", "bond-feed"],
    enabled: Boolean(publicClient),
    refetchInterval: POLL,
    queryFn: async (): Promise<BondEvent[]> => {
      const client = publicClient as ViemClient;
      const [bonded, slashed] = await Promise.all([
        withBlockFallback(client, (fromBlock) =>
          client.getLogs({ address: QUALITY_BOND_EXERCISED, event: bondedEvent, fromBlock, toBlock: "latest" }),
        ),
        withBlockFallback(client, (fromBlock) =>
          client.getLogs({ address: QUALITY_BOND_EXERCISED, event: slashedEvent, fromBlock, toBlock: "latest" }),
        ),
      ]);
      const times = await blockTimestamps(client, [...bonded, ...slashed].map((l) => l.blockNumber));
      const key = (l: { transactionHash: `0x${string}` | null; logIndex: number | null }) =>
        `${l.transactionHash ?? ""}-${l.logIndex ?? 0}`;

      const events: BondEvent[] = [
        ...bonded.map((l) => ({
          id: key(l),
          tool: toolName(l.args.toolId ?? ZERO_HASH),
          handle: toolHandle(l.args.toolId ?? ZERO_HASH),
          kind: "staked" as const,
          amountUsd: centsToUsd(l.args.amount ?? 0n),
          txHash: (l.transactionHash ?? ZERO_HASH) as `0x${string}`,
          ts: times.get((l.blockNumber ?? 0n).toString()) ?? Date.now(),
        })),
        ...slashed.map((l) => ({
          id: key(l),
          tool: toolName(l.args.toolId ?? ZERO_HASH),
          handle: toolHandle(l.args.toolId ?? ZERO_HASH),
          kind: "slashed" as const,
          amountUsd: centsToUsd(l.args.amount ?? 0n),
          reason: `bond slashed to buyer · ${centsToUsd(l.args.remaining ?? 0n).toFixed(2)} remaining`,
          txHash: (l.transactionHash ?? ZERO_HASH) as `0x${string}`,
          ts: times.get((l.blockNumber ?? 0n).toString()) ?? Date.now(),
        })),
      ].sort((a, b) => b.ts - a.ts);

      return events;
    },
  });

  if (data && data.length > 0) return { data, source: "chain" };
  return { data: bondEventsStub, source: "stub" };
}

/** Reverse auctions read from ToolAuction: requestCount → requests(id) + bids(id). */
export function useAuctions(): Sourced<Auction[]> {
  const publicClient = usePublicClient();
  const { data } = useQuery({
    queryKey: ["tiagoh", "auctions"],
    enabled: Boolean(publicClient),
    refetchInterval: POLL,
    queryFn: async (): Promise<Auction[]> => {
      const client = publicClient as ViemClient;
      const count = (await client.readContract({
        address: contracts.toolAuction,
        abi: auctionAbi,
        functionName: "requestCount",
      })) as bigint;
      if (count === 0n) return [];

      const first = count > 8n ? count - 7n : 1n;
      const ids: bigint[] = [];
      for (let i = first; i <= count; i++) ids.push(i);

      const out: Auction[] = [];
      for (const id of ids) {
        const r = (await client.readContract({
          address: contracts.toolAuction,
          abi: auctionAbi,
          functionName: "requests",
          args: [id],
        })) as readonly [string, string, bigint, bigint, number, boolean, boolean, string, bigint];
        const [buyer, capabilityId, maxPrice, deadline, policy, open, settled, winner, winningPrice] = r;
        void buyer;
        void winningPrice;

        const bidN = (await client.readContract({
          address: contracts.toolAuction,
          abi: auctionAbi,
          functionName: "bidCount",
          args: [id],
        })) as bigint;

        const rawBids: Array<{ bidder: string; price: bigint }> = [];
        for (let j = 0n; j < bidN; j++) {
          const b = (await client.readContract({
            address: contracts.toolAuction,
            abi: auctionAbi,
            functionName: "bids",
            args: [id, j],
          })) as readonly [string, bigint];
          rawBids.push({ bidder: b[0], price: b[1] });
        }

        // Overlay reputation score for each bidder.
        const scores = new Map<string, number>();
        await Promise.all(
          [...new Set(rawBids.map((b) => b.bidder))].map(async (addr) => {
            try {
              const s = await client.readContract({
                address: contracts.reputationScorer,
                abi: scorerAbi,
                functionName: "scoreOf",
                args: [addr as Address],
              });
              scores.set(addr.toLowerCase(), Number(s));
            } catch {
              scores.set(addr.toLowerCase(), 0);
            }
          }),
        );

        const isOpen = open;
        const winnerSet = winner && winner !== "0x0000000000000000000000000000000000000000";
        const bids: AuctionBid[] = rawBids.map((b) => {
          const won = !isOpen && winnerSet && b.bidder.toLowerCase() === winner.toLowerCase();
          return {
            bidder: addrHandle(b.bidder),
            handle: addrHandle(b.bidder),
            priceUsd: centsToUsd(b.price),
            reputation: scores.get(b.bidder.toLowerCase()) ?? 0,
            bondUsd: 0,
            etaMs: 0,
            status: won ? "won" : "outbid",
          };
        });

        const policyName: Auction["policy"] = policy === 1 ? "reputation-weighted" : "lowest-price";
        out.push({
          id: String(id),
          capability: shortHash(capabilityId, 8, 6),
          request: `${bids.length} signed bid${bids.length === 1 ? "" : "s"} · ceiling ${centsToUsd(maxPrice).toFixed(2)} · ${policyName}${settled ? " · settled" : ""}`,
          budgetUsd: centsToUsd(maxPrice),
          policy: policyName,
          closesInMs: isOpen ? Math.max(0, Number(deadline) * 1000 - Date.now()) : 0,
          bids,
          status: isOpen ? "open" : "cleared",
          winner: winnerSet ? addrHandle(winner) : undefined,
        });
      }

      return out.reverse();
    },
  });

  if (data && data.length > 0) return { data, source: "chain" };
  return { data: auctionsStub, source: "stub" };
}

/** Disputes read from DisputeArbiter: disputeCount → disputes(id), enriched by events. */
export function useDisputes(): Sourced<Dispute[]> {
  const publicClient = usePublicClient();
  const { data } = useQuery({
    queryKey: ["tiagoh", "disputes"],
    enabled: Boolean(publicClient),
    refetchInterval: POLL,
    queryFn: async (): Promise<Dispute[]> => {
      const client = publicClient as ViemClient;
      const count = (await client.readContract({
        address: contracts.disputeArbiter,
        abi: disputeAbi,
        functionName: "disputeCount",
      })) as bigint;
      if (count === 0n) return [];

      const [openedLogs, ruledLogs] = await Promise.all([
        withBlockFallback(client, (fromBlock) =>
          client.getLogs({ address: contracts.disputeArbiter, event: disputeOpenedEvent, fromBlock, toBlock: "latest" }),
        ),
        withBlockFallback(client, (fromBlock) =>
          client.getLogs({ address: contracts.disputeArbiter, event: disputeRuledEvent, fromBlock, toBlock: "latest" }),
        ),
      ]);
      const times = await blockTimestamps(client, openedLogs.map((l) => l.blockNumber));
      const openedById = new Map(openedLogs.map((l) => [(l.args.disputeId ?? 0n).toString(), l]));
      const ruledById = new Map(ruledLogs.map((l) => [(l.args.disputeId ?? 0n).toString(), l]));

      const first = count > 8n ? count - 7n : 1n;
      const out: Dispute[] = [];
      for (let id = first; id <= count; id++) {
        const d = (await client.readContract({
          address: contracts.disputeArbiter,
          abi: disputeAbi,
          functionName: "disputes",
          args: [id],
        })) as readonly [string, string, string, string, bigint, bigint, bigint, number, boolean];
        const [subject, buyer, seller, toolId, escrowId, slashAmount, deadline, status, forBuyer] = d;
        void buyer;
        void seller;
        void escrowId;

        // Status enum: 1 = OPEN, 2 = RULED.
        const mapped: Dispute["status"] =
          status === 2 ? (forBuyer ? "refunded" : "rejected") : "open";

        const openedLog = openedById.get(id.toString());
        const ruledLog = ruledById.get(id.toString());
        const openedTs = openedLog
          ? times.get((openedLog.blockNumber ?? 0n).toString()) ?? Date.now()
          : Math.max(0, (Number(deadline) - 3 * 86_400) * 1000);
        const txHash = (ruledLog?.transactionHash ?? openedLog?.transactionHash ?? ZERO_HASH) as `0x${string}`;

        out.push({
          id: `dispute-${id}`,
          cascadeId: shortHash(subject, 8, 6),
          tool: toolName(toolId),
          handle: toolHandle(toolId),
          reason:
            status === 2
              ? forBuyer
                ? "Ruled for buyer — escrow refunded and bond slashed to the buyer."
                : "Ruled for seller — bond preserved, no refund issued."
              : "Dispute open — awaiting on-chain ruling within the dispute window.",
          claimUsd: centsToUsd(slashAmount),
          bondUsd: centsToUsd(slashAmount),
          hops: 1,
          status: mapped,
          arbiter: "on-chain juror",
          openedTs,
          txHash,
        });
      }

      return out.reverse();
    },
  });

  if (data && data.length > 0) return { data, source: "chain" };
  return { data: disputesStub, source: "stub" };
}

/** Cascade tree reconstructed from receipt parentId links (payment-graph shape). */
export function useCascade(): Sourced<CascadeNode> {
  const { data } = useReceiptLogs();

  if (data && data.length > 0) {
    const tree = buildCascade(data);
    if (tree) return { data: tree, source: "chain" };
  }
  return { data: cascadeStub, source: "stub" };
}

function buildCascade(rows: DecodedReceipt[]): CascadeNode | null {
  const childrenOf = new Map<string, DecodedReceipt[]>();
  for (const r of rows) {
    if (r.parentId !== ZERO_BYTES32) {
      const key = r.parentId.toLowerCase();
      const list = childrenOf.get(key) ?? [];
      list.push(r);
      childrenOf.set(key, list);
    }
  }
  const roots = rows.filter((r) => r.parentId === ZERO_BYTES32);
  // Prefer a root that actually fans out (a real cascade), else the first root.
  const root = roots.find((r) => childrenOf.has(r.receiptId.toLowerCase())) ?? roots[0];
  if (!root) return null;

  const node = (r: DecodedReceipt, depth: number): CascadeNode => {
    const kids = (childrenOf.get(r.receiptId.toLowerCase()) ?? []).map((c) => node(c, depth + 1));
    const amountUsd = centsToUsd(r.amount);
    return {
      id: r.receiptId,
      label: `${toolName(r.toolId)}()`,
      handle: toolHandle(r.toolId),
      amountUsd,
      budgetUsd: Math.max(amountUsd, amountUsd * 5),
      attributionPct: depth === 0 ? 100 : 20,
      status: "settled",
      ...(kids.length > 0 ? { children: kids } : {}),
    };
  };
  return node(root, 0);
}

/**
 * LIVE read of the deployed ReceiptRegistry (GOAT mainnet) — real client-side
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
