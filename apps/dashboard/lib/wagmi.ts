import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

/**
 * GOAT Network mainnet chain (defined locally so the dashboard is a self-contained
 * Next.js app — deployable anywhere with no workspace build step). The RPC is
 * baked in as the chain default, so no env config is required.
 */
export const goatChain = defineChain({
  id: 2345,
  name: "GOAT Network",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.goat.network"] } },
  blockExplorers: {
    default: { name: "GOAT Explorer", url: "https://explorer.goat.network" },
  },
});

/**
 * wagmi config. Chain reads are the dashboard's main data path and need no backend — every
 * widget reads GOAT directly through this public-RPC transport.
 *
 * The injected connector exists for exactly one thing: the pay-per-call demo on `/pricing`, where
 * a visitor signs an ERC-3009 authorization to buy a tool call. Note what that does *not* need —
 * the wallet only ever produces an EIP-712 **signature**, never a transaction, so the visitor
 * needs no BTC for gas and nothing here ever asks them to send one.
 */
export const wagmiConfig = createConfig({
  chains: [goatChain],
  connectors: [injected({ shimDisconnect: true })],
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
