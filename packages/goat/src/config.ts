import type { Address } from "viem";

const env = (k: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[k] : undefined;

const addr = (k: string): Address | undefined => {
  const v = env(k);
  return v && v.startsWith("0x") ? (v as Address) : undefined;
};

/** Deployed tiagoh contract addresses (from .env after deploy). */
export const contracts = {
  receiptRegistry: addr("RECEIPT_REGISTRY_ADDRESS"),
  revenueSplit: addr("REVENUE_SPLIT_ADDRESS"),
  cascadeController: addr("CASCADE_CONTROLLER_ADDRESS"),
  paymentChannel: addr("PAYMENT_CHANNEL_ADDRESS"),
  qualityBond: addr("QUALITY_BOND_ADDRESS"),
  escrowVault: addr("ESCROW_VAULT_ADDRESS"),
  disputeArbiter: addr("DISPUTE_ARBITER_ADDRESS"),
  reputationScorer: addr("REPUTATION_SCORER_ADDRESS"),
  toolAuction: addr("TOOL_AUCTION_ADDRESS"),
  agentRegistry: addr("AGENT_REGISTRY_ADDRESS"),
} as const;

/** Canonical ERC-8004 registries on GOAT (reuse, do not redeploy). */
export const erc8004 = {
  identity: addr("ERC8004_IDENTITY_REGISTRY"),
  reputation: addr("ERC8004_REPUTATION_REGISTRY"),
  validation: addr("ERC8004_VALIDATION_REGISTRY"),
} as const;

export const paymentToken = addr("TIAGOH_PAYMENT_TOKEN");
export const facilitatorUrl = env("X402_FACILITATOR_URL");
