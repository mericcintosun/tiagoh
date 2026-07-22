/**
 * tiagoh contracts — LIVE on GOAT Network mainnet (chainId 2345).
 *
 * These are real, deployed addresses (see contracts/deployments/goat-mainnet.json).
 * The dashboard reads them client-side via wagmi/viem — no backend. Addresses are
 * public, so they're inlined here (browser env vars can't be read dynamically).
 */

export const GOAT_MAINNET = {
  chainId: 2345,
  rpc: "https://rpc.goat.network",
  explorer: "https://explorer.goat.network",
} as const;

export const deployedContracts = {
  receiptRegistry: "0x9a41F6d67D9082a37A16bDD971acc1659b89f1AA",
  revenueSplit: "0x0193b4865a13955EF646e6532cd024028165aBC5",
  cascadeController: "0xCed393a33e999C14a2E343DAA36fbEb84ce1A4E0",
  paymentChannel: "0x283c174Abf7F868Cda7B038C4a45CbCa45Aa45A7",
  qualityBond: "0x0b592E60706695Dc1E84bFda4f2ec59dc660e980",
  escrowVault: "0x10d7eC7fEbCB3009e2842B35616eA1609249C695",
  disputeArbiter: "0x4D2E9E59be3C600a634b6f5e09C7966DED09C9d7",
  reputationScorer: "0x13E12daAAFDb5E1fe53499BEa8D955Aa0B471215",
  toolAuction: "0x28066960D5f655f9bEbe4B13241b3731F6f04FF7",
  agentRegistry: "0xF509B481c8E07F31442C61F0eF6216C10Fa7CB8a",
  sessionKeyDelegator: "0x1606b7eaB84248b5a48104845398D36E2860FD36",
  bitVM2Arbiter: "0x6C41430855934E8d8c0A2E9F90BfEC6d5A15144d",
  erc8004ReputationRegistry: "0x5002C61966CdA580b16D5f2B08F43FCC71857Fc7",
} as const satisfies Record<string, `0x${string}`>;

/** Explorer link helpers. */
export const addressUrl = (a: string) => `${GOAT_MAINNET.explorer}/address/${a}`;
export const txUrl = (h: string) => `${GOAT_MAINNET.explorer}/tx/${h}`;

/** Minimal ReceiptRegistry ABI for live client-side reads. */
export const receiptRegistryAbi = [
  { type: "function", name: "count", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalVolume", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "childCount",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
