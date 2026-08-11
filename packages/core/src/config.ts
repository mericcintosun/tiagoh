import { z } from "zod";
import { TIAGOH } from "./constants.js";
import { DEFAULT_ASSET_DECIMALS, toMinor, type Minor } from "./money.js";

/**
 * Prices are authored in major units (dollars) because that is what a human writes in
 * `tiagoh.config.json`. They are converted to exact integer minor units **once**, at config
 * load, and never take part in arithmetic as floats — see `money.ts` for why.
 */
export const ToolPriceSchema = z.object({
  name: z.string(),
  priceUsd: z.number().nonnegative(),
  description: z.string().optional(),
});
export type ToolPrice = z.infer<typeof ToolPriceSchema>;

export const BondConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Bond stake in the payment token's smallest unit. */
  amount: z.string().optional(),
  tier: z.enum(["unbonded", "bonded", "high_bond"]).default("unbonded"),
});

/** `tiagoh.config.json` — written by `tiagoh init`, read by `tiagoh wrap`. */
export const TiagohConfigSchema = z.object({
  upstream: z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
  }),
  /** The seller's identity: named as payee on every receipt, and the address that co-signs it. */
  payTo: z.string(),
  /**
   * `X402Settler` address. When set, the buyer's ERC-3009 authorization pays this contract, which
   * takes the protocol fee, forwards the rest to `payTo` and anchors the co-signed receipt in one
   * transaction. Unset, the authorization pays `payTo` directly and the receipt is anchored
   * separately — simpler, but the payment and its evidence can then diverge.
   */
  settler: z.string().optional(),
  /** ERC-3009 / Permit2 payment token address. */
  asset: z.string(),
  /** Decimals of the payment token; every internal amount is an integer in these units. */
  assetDecimals: z.number().int().min(0).max(36).default(DEFAULT_ASSET_DECIMALS),
  facilitatorUrl: z.string().url().optional(),
  chainId: z.number().default(TIAGOH.DEFAULT_CHAIN_ID),
  port: z.number().default(TIAGOH.DEFAULT_PORT),
  tools: z.array(ToolPriceSchema).default([]),
  bond: BondConfigSchema.optional(),
});
export type TiagohConfig = z.infer<typeof TiagohConfigSchema>;

export function parseConfig(input: unknown): TiagohConfig {
  return TiagohConfigSchema.parse(input);
}

/** A tool's price in exact minor units. `undefined` means the tool is not priced (free). */
export function toolPriceMinor(config: TiagohConfig, tool: string): Minor | undefined {
  const priced = config.tools.find((t) => t.name === tool);
  if (!priced) return undefined;
  return toMinor(priced.priceUsd, config.assetDecimals);
}
