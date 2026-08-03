import { defineChain } from "viem";

/**
 * GOAT Network chain definitions for viem.
 *
 * NOTE: verify the chain id / RPC / explorer against https://docs.goat.network
 * before mainnet. Values are env-overridable so the same build works across
 * environments (Node + browser via NEXT_PUBLIC_*).
 */
const env = (k: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[k] : undefined;

// Testnet is addressed by its own vars, so pointing the app at testnet is a deliberate act
// rather than a side effect of one shared GOAT_RPC_URL.
const TESTNET_ID = Number(env("GOAT_TESTNET_CHAIN_ID") ?? 48816);
const TESTNET_RPC = env("GOAT_TESTNET_RPC_URL") ?? "https://rpc.testnet3.goat.network";
const TESTNET_EXPLORER =
  env("GOAT_TESTNET_EXPLORER_URL") ?? "https://explorer.testnet3.goat.network";

export const goatTestnet = defineChain({
  id: TESTNET_ID,
  name: "GOAT Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [TESTNET_RPC] } },
  blockExplorers: { default: { name: "GOAT Explorer", url: TESTNET_EXPLORER } },
  testnet: true,
});

export const goatMainnet = defineChain({
  id: 2345,
  name: "GOAT Network",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.goat.network"] } },
  blockExplorers: { default: { name: "GOAT Explorer", url: "https://explorer.goat.network" } },
});

/**
 * The chain tiagoh targets by default.
 *
 * This is mainnet, matching where the contracts actually live. It used to default to Testnet3
 * while every address in the app pointed at mainnet, so a read that looked live ("reputation:
 * unavailable") was really a query sent to the wrong network — the kind of mismatch that reads
 * as a working feature until someone checks.
 *
 * Override per environment with GOAT_CHAIN_ID / GOAT_RPC_URL (or the NEXT_PUBLIC_* forms in the
 * browser); `goatTestnet` remains exported for explicit testnet use.
 */
export const goatChain = defineChain({
  id: Number(env("GOAT_CHAIN_ID") ?? env("NEXT_PUBLIC_GOAT_CHAIN_ID") ?? 2345),
  name: "GOAT Network",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        env("GOAT_RPC_URL") ?? env("NEXT_PUBLIC_GOAT_RPC_URL") ?? "https://rpc.goat.network",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "GOAT Explorer",
      url:
        env("GOAT_EXPLORER_URL") ??
        env("NEXT_PUBLIC_GOAT_EXPLORER_URL") ??
        "https://explorer.goat.network",
    },
  },
});
