import { createPublicClient, createWalletClient, http, type Hex, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { goatChain } from "./chain.js";

/** Read-only client — this is all the dashboard needs (no backend to host). */
export function goatPublicClient(opts?: { chain?: Chain; rpcUrl?: string }) {
  return createPublicClient({
    chain: opts?.chain ?? goatChain,
    transport: http(opts?.rpcUrl),
  });
}

/** Signing client for the seller gateway / buyer client / autonomous agent. */
export function goatWalletClient(privateKey: Hex, opts?: { chain?: Chain; rpcUrl?: string }) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: opts?.chain ?? goatChain,
    transport: http(opts?.rpcUrl),
  });
}
