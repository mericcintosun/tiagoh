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
  receiptRegistry: "0x87c8D46366918C848012Ad048cEba32f11645042",
  revenueSplit: "0x00ee1Ec92dE3724A833996DD1e10Df9d31Be7F6E",
  cascadeController: "0x4165bC62a07d3A49C836CD08C1951cd7a795FDBc",
  paymentChannel: "0xa823412c5710F43A6e17FC9A0Ff43eae37dc750f",
  qualityBond: "0x5d806CDF5cE7E7e7A8f01872d8Ac917b88db3AA3",
  escrowVault: "0xA27aD6a950c33558F19ED0944Cb780F208577813",
  disputeArbiter: "0x5dc0dd5013aAa31ac38497fa2d8b6D709d2A5F3b",
  reputationScorer: "0x3823eCd18FFEE1e8dD3F40467B0b64970bD95f5a",
  toolAuction: "0x985B7620CB61c1bDa44d47d2a8fC9c89824F83AB",
  agentRegistry: "0x6CD0eDed2615BEa1d116D70461A7d8315efde154",
  sessionKeyDelegator: "0x0325537DA2895B42B667309eC7450481A6CE2a0b",
  bitVM2Arbiter: "0x5aebd55aDB15A39E43bE237b0dEC4A20352924EE",
  erc8004ReputationRegistry: "0x9E3125d4cc46165c5BE323E3E4340Fc2Be76e75a",
  demoToken: "0xFd7315139eB2A77C7E87222F54c9711C7921f5Bc",
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
