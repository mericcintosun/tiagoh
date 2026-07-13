import { createConfig, http } from "wagmi";
import { defineChain } from "viem";

/**
 * GOAT Testnet3 chain (defined locally so the dashboard is a self-contained
 * Next.js app — deployable anywhere with no workspace build step). The RPC is
 * baked in as the chain default, so no env config is required.
 */
export const goatChain = defineChain({
  id: 48816,
  name: "GOAT Testnet3",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet3.goat.network"] } },
  blockExplorers: {
    default: { name: "GOAT Explorer", url: "https://explorer.testnet3.goat.network" },
  },
  testnet: true,
});

/**
 * wagmi config — the dashboard's ONLY data path is read-only chain access.
 * There is NO backend to host: every widget reads directly from the GOAT chain
 * through this public-RPC transport (viem under the hood).
 */
export const wagmiConfig = createConfig({
  chains: [goatChain],
  ssr: true,
  transports: {
    [goatChain.id]: http(process.env.NEXT_PUBLIC_GOAT_RPC_URL),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
