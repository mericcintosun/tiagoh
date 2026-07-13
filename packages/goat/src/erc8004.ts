/**
 * ERC-8004 — ready to use, straight from @goatnetwork/agentkit.
 *
 * Identity: register agents/tools and resolve their wallets + metadata.
 * Reputation: give/revoke feedback and read scores — the signal source
 * tiagoh's ReputationScorer aggregates on top of.
 */
import {
  erc8004RegisterAgentAction,
  erc8004GetAgentWalletAction,
  erc8004SetAgentURIAction,
  erc8004GetMetadataAction,
  erc8004SetMetadataAction,
  erc8004GetReputationAction,
  erc8004GiveFeedbackAction,
  erc8004RevokeFeedbackAction,
  erc8004GetClientsAction,
  getIdentityRegistryAddress,
  getReputationRegistryAddress,
} from "@goatnetwork/agentkit";

export {
  erc8004RegisterAgentAction,
  erc8004GetAgentWalletAction,
  erc8004SetAgentURIAction,
  erc8004GetMetadataAction,
  erc8004SetMetadataAction,
  erc8004GetReputationAction,
  erc8004GiveFeedbackAction,
  erc8004RevokeFeedbackAction,
  erc8004GetClientsAction,
  getIdentityRegistryAddress,
  getReputationRegistryAddress,
};

/** Identity-only actions (register / resolve). */
export const ERC8004_IDENTITY_ACTIONS = [
  erc8004RegisterAgentAction,
  erc8004GetAgentWalletAction,
  erc8004SetAgentURIAction,
  erc8004GetMetadataAction,
  erc8004SetMetadataAction,
] as const;

/** Reputation actions (feedback in/out). */
export const ERC8004_REPUTATION_ACTIONS = [
  erc8004GetReputationAction,
  erc8004GiveFeedbackAction,
  erc8004RevokeFeedbackAction,
  erc8004GetClientsAction,
] as const;

/** The full ERC-8004 action set. */
export const ERC8004_ACTIONS = [
  ...ERC8004_IDENTITY_ACTIONS,
  ...ERC8004_REPUTATION_ACTIONS,
] as const;
