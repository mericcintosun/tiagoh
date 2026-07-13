/**
 * @tiagoh/goat — the GOAT Network foundation for tiagoh.
 *
 * Wraps @goatnetwork/agentkit so x402 payments and ERC-8004 identity/reputation
 * are ready out of the box, plus viem chain + clients for read-only (dashboard)
 * and signing (gateway/client/agent) use. No backend to host.
 */
export * from "./chain.js";
export * from "./clients.js";
export * from "./config.js";
export * from "./x402.js";
export * from "./erc8004.js";
export * from "./mcp.js";
export * from "./runtime.js";
export * from "./settle.js";
export * from "./reputation.js";
export * from "./revenue.js";
