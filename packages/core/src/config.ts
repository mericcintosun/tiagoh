import { z } from "zod";
import { TIAGOH } from "./constants.js";

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
  /** Address (or RevenueSplit contract) that receives payment. */
  payTo: z.string(),
  /** ERC-3009 / Permit2 payment token address. */
  asset: z.string(),
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
