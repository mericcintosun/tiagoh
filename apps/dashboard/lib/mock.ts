/**
 * Typed fallback data for tiagoh surfaces.
 *
 * The live data comes from lib/chain-data.ts, which decodes the deployed GOAT
 * Testnet3 contracts client side (getLogs + readContract). These typed rows are the
 * fallback each hook returns if a chain read errors or is empty, so the UI never
 * breaks. Shapes mirror the PRD sections 5 and 7 contract models.
 */

import { deployedContracts } from "@/lib/deployments";

export type Address = `0x${string}`;
export type Hash = `0x${string}`;

export type ReceiptStatus = "settled" | "pending" | "refunded" | "slashed";

export interface Receipt {
  id: string;
  tool: string;
  handle: string; // .goat handle
  callId: string;
  parentId: string | null; // cascade parent
  amountUsd: number;
  status: ReceiptStatus;
  txHash: Hash;
  payer: string; // .goat handle
  ts: number;
}

export interface RevenuePoint {
  date: string; // e.g. "Jul 01"
  revenueUsd: number;
  calls: number;
}

export interface CascadeNode {
  id: string;
  label: string;
  handle: string;
  amountUsd: number;
  budgetUsd: number;
  attributionPct: number; // share flowing up to parent
  status: "settled" | "pending" | "rejected";
  children?: CascadeNode[];
}

export interface ReputationEntry {
  rank: number;
  tool: string;
  handle: string;
  score: number; // 0–1000
  successRate: number; // 0–100
  volume: number; // settled calls
  disputes: number;
  slashes: number;
  bondUsd: number;
  uniquePayers: number;
  trend: "up" | "down" | "flat";
}

export interface BondEvent {
  id: string;
  tool: string;
  handle: string;
  kind: "staked" | "slashed" | "refund" | "topup";
  amountUsd: number;
  reason?: string;
  txHash: Hash;
  ts: number;
}

export interface AuctionBid {
  bidder: string;
  handle: string;
  priceUsd: number;
  reputation: number; // 0–1000
  bondUsd: number;
  etaMs: number;
  status: "leading" | "outbid" | "won" | "ineligible";
}

export interface Auction {
  id: string;
  capability: string;
  request: string;
  budgetUsd: number;
  policy: "lowest-price" | "reputation-weighted";
  closesInMs: number;
  bids: AuctionBid[];
  status: "open" | "cleared";
  winner?: string;
}

export interface Dispute {
  id: string;
  cascadeId: string;
  tool: string;
  handle: string;
  reason: string;
  claimUsd: number;
  bondUsd: number;
  hops: number;
  status: "open" | "arbitrating" | "refunded" | "rejected";
  arbiter: string;
  openedTs: number;
  txHash: Hash;
}

export interface ContractInfo {
  name: string;
  purpose: string;
  address: Address | null;
  status: "live" | "pending";
}

export interface StatTile {
  label: string;
  value: string;
  sub: string;
  accent: "primary" | "flow" | "success" | "warning" | "destructive";
}

const H = (seed: string): Hash =>
  (`0x${seed.padEnd(64, "0").slice(0, 64)}`) as Hash;

const NOW = 1_752_000_000_000; // fixed reference (deterministic SSR/CSR, no hydration drift)

// ── Hero stat tiles ─────────────────────────────────────────────────────────
export const heroStats: StatTile[] = [
  { label: "contracts live", value: "10", sub: "GOAT Testnet3", accent: "primary" },
  { label: "contract tests", value: "16/16", sub: "all passing", accent: "success" },
  { label: "x402 flow", value: "end-to-end", sub: "pay per call", accent: "flow" },
  { label: "on-chain proof", value: "live txns", sub: "receipts + slash", accent: "warning" },
];

// ── Dashboard stat tiles ────────────────────────────────────────────────────
export const dashboardStats: StatTile[] = [
  { label: "receipts", value: "on-chain", sub: "GOAT Testnet3", accent: "primary" },
  { label: "billing", value: "charge-on-success", sub: "failed calls are free", accent: "flow" },
  { label: "output", value: "quality-bonded", sub: "refund on bad output", accent: "success" },
  { label: "settlement", value: "Bitcoin finality", sub: "via GOAT", accent: "warning" },
];

// ── Revenue series (30 pts) ─────────────────────────────────────────────────
export const revenueSeries: RevenuePoint[] = Array.from({ length: 30 }, (_, i) => {
  const base = 900 + Math.sin(i / 3.1) * 320 + i * 46;
  const revenueUsd = Math.max(180, Math.round(base + (i % 5 === 0 ? 260 : 0)));
  const d = new Date(NOW - (29 - i) * 86_400_000);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  return { date, revenueUsd, calls: Math.round(revenueUsd / 2.4) };
});

// ── Receipts ────────────────────────────────────────────────────────────────
export const receipts: Receipt[] = [
  {
    id: "r1",
    tool: "goat-defi-data",
    handle: "defidata.goat",
    callId: "call_9f2a",
    parentId: null,
    amountUsd: 0.42,
    status: "settled",
    txHash: H("a1defidata9f2a"),
    payer: "opus-buyer.goat",
    ts: NOW - 42_000,
  },
  {
    id: "r2",
    tool: "portfolio-analyst",
    handle: "portfolio.goat",
    callId: "call_71bd",
    parentId: "call_9f2a",
    amountUsd: 1.2,
    status: "settled",
    txHash: H("b2portfolio71bd"),
    payer: "opus-buyer.goat",
    ts: NOW - 120_000,
  },
  {
    id: "r3",
    tool: "rwa-oracle",
    handle: "rwa.goat",
    callId: "call_33cf",
    parentId: "call_71bd",
    amountUsd: 0.28,
    status: "settled",
    txHash: H("c3rwaoracle33cf"),
    payer: "portfolio.goat",
    ts: NOW - 210_000,
  },
  {
    id: "r4",
    tool: "yield-scanner",
    handle: "yields.goat",
    callId: "call_5a0e",
    parentId: null,
    amountUsd: 0.9,
    status: "pending",
    txHash: H("d4yield5a0e"),
    payer: "trader-agent.goat",
    ts: NOW - 8_000,
  },
  {
    id: "r5",
    tool: "sentiment-feed",
    handle: "sentiment.goat",
    callId: "call_c410",
    parentId: null,
    amountUsd: 0.15,
    status: "refunded",
    txHash: H("e5sentimentc410"),
    payer: "opus-buyer.goat",
    ts: NOW - 640_000,
  },
  {
    id: "r6",
    tool: "cheap-summarizer",
    handle: "summary.goat",
    callId: "call_88fa",
    parentId: "call_5a0e",
    amountUsd: 0.05,
    status: "slashed",
    txHash: H("f6summary88fa"),
    payer: "yields.goat",
    ts: NOW - 900_000,
  },
  {
    id: "r7",
    tool: "goat-defi-data",
    handle: "defidata.goat",
    callId: "call_1002",
    parentId: null,
    amountUsd: 0.42,
    status: "settled",
    txHash: H("a7defidata1002"),
    payer: "quant-swarm.goat",
    ts: NOW - 1_400_000,
  },
  {
    id: "r8",
    tool: "chart-render",
    handle: "charts.goat",
    callId: "call_6b7c",
    parentId: "call_1002",
    amountUsd: 0.33,
    status: "settled",
    txHash: H("a8charts6b7c"),
    payer: "quant-swarm.goat",
    ts: NOW - 1_800_000,
  },
];

// ── Cascade tree (playground default) ───────────────────────────────────────
export const cascadeTree: CascadeNode = {
  id: "root",
  label: "portfolio.analyze()",
  handle: "portfolio.goat",
  amountUsd: 1.2,
  budgetUsd: 5.0,
  attributionPct: 100,
  status: "settled",
  children: [
    {
      id: "n1",
      label: "market.prices()",
      handle: "defidata.goat",
      amountUsd: 0.42,
      budgetUsd: 2.0,
      attributionPct: 12,
      status: "settled",
      children: [
        {
          id: "n1a",
          label: "rwa.spot()",
          handle: "rwa.goat",
          amountUsd: 0.28,
          budgetUsd: 0.8,
          attributionPct: 8,
          status: "settled",
        },
      ],
    },
    {
      id: "n2",
      label: "yield.scan()",
      handle: "yields.goat",
      amountUsd: 0.9,
      budgetUsd: 1.5,
      attributionPct: 15,
      status: "settled",
    },
    {
      id: "n3",
      label: "premium.forecast()",
      handle: "forecast.goat",
      amountUsd: 3.4,
      budgetUsd: 1.0,
      attributionPct: 0,
      status: "rejected", // over per-hop budget → BudgetExceeded
    },
  ],
};

// ── Reputation leaderboard ──────────────────────────────────────────────────
export const leaderboard: ReputationEntry[] = [
  {
    rank: 1,
    tool: "goat-defi-data",
    handle: "defidata.goat",
    score: 947,
    successRate: 99.4,
    volume: 8420,
    disputes: 3,
    slashes: 0,
    bondUsd: 5000,
    uniquePayers: 214,
    trend: "up",
  },
  {
    rank: 2,
    tool: "portfolio-analyst",
    handle: "portfolio.goat",
    score: 912,
    successRate: 98.9,
    volume: 5120,
    disputes: 5,
    slashes: 0,
    bondUsd: 3500,
    uniquePayers: 168,
    trend: "up",
  },
  {
    rank: 3,
    tool: "rwa-oracle",
    handle: "rwa.goat",
    score: 884,
    successRate: 98.1,
    volume: 3980,
    disputes: 7,
    slashes: 1,
    bondUsd: 3000,
    uniquePayers: 132,
    trend: "flat",
  },
  {
    rank: 4,
    tool: "yield-scanner",
    handle: "yields.goat",
    score: 851,
    successRate: 97.3,
    volume: 2760,
    disputes: 9,
    slashes: 1,
    bondUsd: 2500,
    uniquePayers: 98,
    trend: "up",
  },
  {
    rank: 5,
    tool: "chart-render",
    handle: "charts.goat",
    score: 806,
    successRate: 96.4,
    volume: 2110,
    disputes: 11,
    slashes: 2,
    bondUsd: 1500,
    uniquePayers: 74,
    trend: "down",
  },
  {
    rank: 6,
    tool: "cheap-summarizer",
    handle: "summary.goat",
    score: 612,
    successRate: 88.2,
    volume: 940,
    disputes: 28,
    slashes: 6,
    bondUsd: 500,
    uniquePayers: 41,
    trend: "down",
  },
];

// ── Bond feed ───────────────────────────────────────────────────────────────
export const bondEvents: BondEvent[] = [
  {
    id: "b1",
    tool: "goat-defi-data",
    handle: "defidata.goat",
    kind: "staked",
    amountUsd: 5000,
    txHash: H("bond_stake_defidata"),
    ts: NOW - 3_600_000,
  },
  {
    id: "b2",
    tool: "cheap-summarizer",
    handle: "summary.goat",
    kind: "slashed",
    amountUsd: 250,
    reason: "schema-mismatch output flagged by verifier oracle",
    txHash: H("bond_slash_summary"),
    ts: NOW - 900_000,
  },
  {
    id: "b3",
    tool: "opus-buyer.goat",
    handle: "opus-buyer.goat",
    kind: "refund",
    amountUsd: 250,
    reason: "auto-refund from slashed bond",
    txHash: H("bond_refund_opus"),
    ts: NOW - 890_000,
  },
  {
    id: "b4",
    tool: "yield-scanner",
    handle: "yields.goat",
    kind: "topup",
    amountUsd: 1000,
    txHash: H("bond_topup_yields"),
    ts: NOW - 5_400_000,
  },
];

// ── Auctions ────────────────────────────────────────────────────────────────
export const auctions: Auction[] = [
  {
    id: "auc_01",
    capability: "onchain.price.feed",
    request: "BTC + top-10 GOAT DeFi TVL, < 400ms, signed source",
    budgetUsd: 1.5,
    policy: "reputation-weighted",
    closesInMs: 14_000,
    status: "open",
    bids: [
      {
        bidder: "goat-defi-data",
        handle: "defidata.goat",
        priceUsd: 0.42,
        reputation: 947,
        bondUsd: 5000,
        etaMs: 210,
        status: "leading",
      },
      {
        bidder: "rwa-oracle",
        handle: "rwa.goat",
        priceUsd: 0.38,
        reputation: 884,
        bondUsd: 3000,
        etaMs: 340,
        status: "outbid",
      },
      {
        bidder: "cheap-feed",
        handle: "cheapfeed.goat",
        priceUsd: 0.19,
        reputation: 540,
        bondUsd: 300,
        etaMs: 620,
        status: "outbid",
      },
      {
        bidder: "no-bond-feed",
        handle: "nobond.goat",
        priceUsd: 0.09,
        reputation: 210,
        bondUsd: 0,
        etaMs: 500,
        status: "ineligible",
      },
    ],
  },
  {
    id: "auc_02",
    capability: "text.summarize",
    request: "Summarize 12 filings → 200 words, factual",
    budgetUsd: 0.6,
    policy: "lowest-price",
    closesInMs: 0,
    status: "cleared",
    winner: "portfolio.goat",
    bids: [
      {
        bidder: "portfolio-analyst",
        handle: "portfolio.goat",
        priceUsd: 0.22,
        reputation: 912,
        bondUsd: 3500,
        etaMs: 800,
        status: "won",
      },
      {
        bidder: "chart-render",
        handle: "charts.goat",
        priceUsd: 0.31,
        reputation: 806,
        bondUsd: 1500,
        etaMs: 900,
        status: "outbid",
      },
    ],
  },
];

// ── Disputes ────────────────────────────────────────────────────────────────
export const disputes: Dispute[] = [
  {
    id: "dsp_01",
    cascadeId: "call_5a0e",
    tool: "cheap-summarizer",
    handle: "summary.goat",
    reason: "Returned malformed JSON; schema mismatch vs signed source",
    claimUsd: 0.95,
    bondUsd: 500,
    hops: 3,
    status: "refunded",
    arbiter: "thoughtproof.goat",
    openedTs: NOW - 900_000,
    txHash: H("dispute_summary_refund"),
  },
  {
    id: "dsp_02",
    cascadeId: "call_a1b2",
    tool: "forecast",
    handle: "forecast.goat",
    reason: "Timeout > 5s SLA on premium.forecast()",
    claimUsd: 3.4,
    bondUsd: 2000,
    hops: 2,
    status: "arbitrating",
    arbiter: "verifier-swarm.goat",
    openedTs: NOW - 300_000,
    txHash: H("dispute_forecast_open"),
  },
  {
    id: "dsp_03",
    cascadeId: "call_c9d0",
    tool: "sentiment-feed",
    handle: "sentiment.goat",
    reason: "Output contradicts two independent signed sources",
    claimUsd: 0.15,
    bondUsd: 800,
    hops: 1,
    status: "open",
    arbiter: "pending",
    openedTs: NOW - 60_000,
    txHash: H("dispute_sentiment_open"),
  },
];

// ── Contracts grid ──────────────────────────────────────────────────────────
export const contractGrid: ContractInfo[] = [
  { name: "ReceiptRegistry", purpose: "Anchor settled receipts + cascade parentId", address: deployedContracts.receiptRegistry, status: "live" },
  { name: "RevenueSplit", purpose: "Pull-based fixed-weight revenue splits", address: deployedContracts.revenueSplit, status: "live" },
  { name: "CascadeController", purpose: "Budget tree, per-hop cap, recursive attribution", address: deployedContracts.cascadeController, status: "live" },
  { name: "PaymentChannel", purpose: "Prepaid channels, signed vouchers, redeem", address: deployedContracts.paymentChannel, status: "live" },
  { name: "QualityBond", purpose: "Stake, slash, bond-backed refund", address: deployedContracts.qualityBond, status: "live" },
  { name: "EscrowVault", purpose: "Conditional hold + atomic cascade unwind", address: deployedContracts.escrowVault, status: "live" },
  { name: "DisputeArbiter", purpose: "Dispute window + ruling, BitVM2 hook", address: deployedContracts.disputeArbiter, status: "live" },
  { name: "ReputationScorer", purpose: "Aggregate score over receipts + slashes", address: deployedContracts.reputationScorer, status: "live" },
  { name: "ToolAuction", purpose: "Open request, collect bids, clear + settle", address: deployedContracts.toolAuction, status: "live" },
  { name: "AgentRegistry", purpose: "ERC-8004 identity + capped delegation", address: deployedContracts.agentRegistry, status: "live" },
];
