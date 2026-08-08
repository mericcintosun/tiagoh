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
  receiptRegistry: "0xa5bEfC1bdc7ec16EfB0ecF8866566A9405999112",
  revenueSplit: "0x2EDCd213F6A54A32079EE48B0da576ACE949f498",
  cascadeController: "0x3d7c7C21178F5d436004a1A44D42b8e7D0b322C8",
  paymentChannel: "0x096F12309D718FC6E97e142B55feF2120647aB8B",
  qualityBond: "0x24Df4B7f3ECd1c5692D1e8FC91d46e119c355555",
  escrowVault: "0xD6136DEc8D553D71DC5e865b89cC03b42b08BbF9",
  disputeArbiter: "0x7fd534d61Baa0fB6Cc7D638A855e929B1a997291",
  reputationScorer: "0x35aD6433d2e532c0938D79353F6882f68F2d36D2",
  toolAuction: "0x83964A9e06661BE11DC702989FE7df4186a716Ea",
  agentRegistry: "0xE8B5a5057300eD093BC363C77772f334B0a36e2c",
  sessionKeyDelegator: "0x307D63c900Fe15F8282f88bb8b9FF036c7Aac263",
  bitVM2Arbiter: "0x835E17d82c7393e974A6316Ac8BBF01B2132dB7a",
  // Canonical ERC-8004 registries (shared, not ours — same 0x8004… addresses on every mainnet).
  erc8004Identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  erc8004Reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  erc8004Validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
  // Real bridged stablecoin the suite settles in (Stargate USDC.e, 6 decimals).
  paymentToken: "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
} as const satisfies Record<string, `0x${string}`>;

/**
 * Earlier mainnet suites (DemoToken-bound). Kept so historical receipts stay
 * countable; excluded from headline metrics as internal/test traffic.
 */
export const legacySuites = [
  { label: "launch (DemoToken)", receiptRegistry: "0x9a41F6d67D9082a37A16bDD971acc1659b89f1AA" },
  { label: "hardened (DemoToken)", receiptRegistry: "0x87c8D46366918C848012Ad048cEba32f11645042" },
] as const;

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
