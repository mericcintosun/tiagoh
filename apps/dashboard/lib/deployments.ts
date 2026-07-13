/**
 * tiagoh contracts — LIVE on GOAT Testnet3 (chainId 48816).
 *
 * These are real, deployed addresses (see contracts/deployments/goat-testnet3.json).
 * The dashboard reads them client-side via wagmi/viem — no backend. Addresses are
 * public, so they're inlined here (browser env vars can't be read dynamically).
 */

export const GOAT_TESTNET3 = {
  chainId: 48816,
  rpc: "https://rpc.testnet3.goat.network",
  explorer: "https://explorer.testnet3.goat.network",
} as const;

export const deployedContracts = {
  receiptRegistry: "0xb55822243ea12738A50De04B0AeE4f671732FFBb",
  revenueSplit: "0x9A846F7bEAF29622579EF71D095Ae96c7345cd23",
  cascadeController: "0x9a41F6d67D9082a37A16bDD971acc1659b89f1AA",
  paymentChannel: "0x0193b4865a13955EF646e6532cd024028165aBC5",
  qualityBond: "0xCed393a33e999C14a2E343DAA36fbEb84ce1A4E0",
  escrowVault: "0x283c174Abf7F868Cda7B038C4a45CbCa45Aa45A7",
  disputeArbiter: "0x0b592E60706695Dc1E84bFda4f2ec59dc660e980",
  reputationScorer: "0x10d7eC7fEbCB3009e2842B35616eA1609249C695",
  toolAuction: "0x4D2E9E59be3C600a634b6f5e09C7966DED09C9d7",
  agentRegistry: "0x13E12daAAFDb5E1fe53499BEa8D955Aa0B471215",
  sessionKeyDelegator: "0x24Df4B7f3ECd1c5692D1e8FC91d46e119c355555",
  bitVM2Arbiter: "0x35aD6433d2e532c0938D79353F6882f68F2d36D2",
  erc8004ReputationRegistry: "0x59ABEE0BA201E99AEAa2E80141D291e2ac4a88A2",
} as const satisfies Record<string, `0x${string}`>;

/** Explorer link helpers. */
export const addressUrl = (a: string) => `${GOAT_TESTNET3.explorer}/address/${a}`;
export const txUrl = (h: string) => `${GOAT_TESTNET3.explorer}/tx/${h}`;

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
