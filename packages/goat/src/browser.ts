/**
 * @tiagoh/goat/browser — the browser-safe subset (chain + clients + config).
 *
 * This entry pulls in ONLY viem, so the dashboard can read the GOAT chain
 * client-side without bundling the Node-only agentkit surface (ioredis, ethers).
 * The dashboard has no backend; this is all it needs.
 */
export * from "./chain.js";
export * from "./clients.js";
export * from "./config.js";
