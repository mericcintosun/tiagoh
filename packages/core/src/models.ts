import { z } from "zod";

/** A settled (or in-flight) per-tool-call payment, anchored on-chain. */
export const ReceiptSchema = z.object({
  paymentId: z.string(),
  parentId: z.string().nullable().default(null),
  tool: z.string(),
  payer: z.string(),
  payee: z.string(),
  amountUsd: z.number().nonnegative(),
  asset: z.string(),
  txHash: z.string().optional(),
  status: z.enum(["pending", "settled", "refunded", "disputed", "slashed"]).default("pending"),
  createdAt: z.number(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** One hop in a cascade payment tree. */
export interface CascadeHop {
  paymentId: string;
  parentId: string | null;
  payee: string;
  amountUsd: number;
  /** Share of this hop's earnings attributed up to the parent payee. */
  attributionBps: number;
}

export interface CascadeTree {
  cascadeId: string;
  rootId: string;
  budgetUsd: number;
  spentUsd: number;
  hops: CascadeHop[];
}

/** Seller quality bond (§5.2). */
export const BondSchema = z.object({
  tool: z.string(),
  tier: z.enum(["unbonded", "bonded", "high_bond"]),
  amount: z.string(),
  slashes: z.number().int().nonnegative().default(0),
  lockedUntil: z.number().optional(),
});
export type Bond = z.infer<typeof BondSchema>;

/** Dispute over a paid call (§5.4). */
export const DisputeSchema = z.object({
  id: z.string(),
  receiptId: z.string(),
  opener: z.string(),
  reason: z.string(),
  status: z.enum(["open", "ruled_buyer", "ruled_seller", "expired"]).default("open"),
  openedAt: z.number(),
});
export type Dispute = z.infer<typeof DisputeSchema>;

/** A bid in a reverse tool auction (§5.5). */
export const BidSchema = z.object({
  bidder: z.string(),
  priceUsd: z.number().nonnegative(),
  reputation: z.number().optional(),
});
export type Bid = z.infer<typeof BidSchema>;

export const AuctionSchema = z.object({
  id: z.string(),
  capability: z.string(),
  bids: z.array(BidSchema).default([]),
  winner: z.string().optional(),
  clearedPriceUsd: z.number().optional(),
  status: z.enum(["open", "cleared", "settled"]).default("open"),
});
export type Auction = z.infer<typeof AuctionSchema>;

/** Aggregated reputation for a tool or agent (§5.1). */
export const ReputationSchema = z.object({
  subject: z.string(),
  score: z.number(),
  volume: z.number().nonnegative(),
  successRate: z.number().min(0).max(1),
  disputeRate: z.number().min(0).max(1),
  slashes: z.number().int().nonnegative(),
  uniquePayers: z.number().int().nonnegative(),
});
export type Reputation = z.infer<typeof ReputationSchema>;
