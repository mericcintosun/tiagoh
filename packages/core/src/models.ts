import { z } from "zod";
import { DEFAULT_ASSET_DECIMALS } from "./money.js";

/**
 * A base-10 integer string in the payment token's minor units.
 *
 * Amounts are never floats on this path: a receipt is co-signed by both parties and anchored
 * on-chain, so its amount has to be exactly the integer both signatures cover and the chain
 * stores. `bigint` cannot cross `JSON.stringify`, so the wire form is the integer as a string.
 */
export const MinorAmountSchema = z.string().regex(/^\d+$/, "expected integer minor units");

/** A settled (or in-flight) per-tool-call payment, anchored on-chain. */
export const ReceiptSchema = z.object({
  /** Deterministic id derived from the challenge nonce — see `deriveReceiptId`. */
  paymentId: z.string(),
  parentId: z.string().nullable().default(null),
  tool: z.string(),
  payer: z.string(),
  payee: z.string(),
  /** Price in the payment token's minor units. */
  amount: MinorAmountSchema,
  asset: z.string(),
  assetDecimals: z.number().int().min(0).max(36).default(DEFAULT_ASSET_DECIMALS),
  txHash: z.string().optional(),
  status: z.enum(["pending", "settled", "refunded", "disputed", "slashed"]).default("pending"),
  createdAt: z.number(),
  /**
   * Both parties' EIP-712 signatures over the receipt. A receipt carrying both is *evidence*:
   * anyone can anchor it permissionlessly, and neither side can forge or suppress it. A receipt
   * missing them is telemetry only, and `DisputeArbiter` will not bind harm to it.
   */
  payerSignature: z.string().optional(),
  payeeSignature: z.string().optional(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** True when a receipt carries both signatures and therefore counts as dispute-grade evidence. */
export function isCosigned(receipt: Receipt): boolean {
  return Boolean(receipt.payerSignature && receipt.payeeSignature);
}

/** One hop in a cascade payment tree. */
export interface CascadeHop {
  paymentId: string;
  parentId: string | null;
  payee: string;
  /** Minor units, base-10 integer string. */
  amount: string;
  /** Share of this hop's earnings attributed up to the parent payee. */
  attributionBps: number;
}

export interface CascadeTree {
  cascadeId: string;
  rootId: string;
  /** Minor units, base-10 integer strings. */
  budget: string;
  spent: string;
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
  /** Minor units, base-10 integer string. */
  price: MinorAmountSchema,
  reputation: z.number().optional(),
});
export type Bid = z.infer<typeof BidSchema>;

export const AuctionSchema = z.object({
  id: z.string(),
  capability: z.string(),
  bids: z.array(BidSchema).default([]),
  winner: z.string().optional(),
  clearedPrice: MinorAmountSchema.optional(),
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
