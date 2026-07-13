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

const TESTNET_ID = Number(env("GOAT_CHAIN_ID") ?? env("NEXT_PUBLIC_GOAT_CHAIN_ID") ?? 48816);
const TESTNET_RPC =
  env("GOAT_RPC_URL") ?? env("NEXT_PUBLIC_GOAT_RPC_URL") ?? "https://rpc.testnet3.goat.network";
const TESTNET_EXPLORER =
  env("GOAT_EXPLORER_URL") ??
  env("NEXT_PUBLIC_GOAT_EXPLORER_URL") ??
  "https://explorer.testnet3.goat.network";

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

/** The chain tiagoh targets by default (testnet during the build phase). */
export const goatChain = goatTestnet;
