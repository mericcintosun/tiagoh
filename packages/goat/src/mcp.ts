/**
 * MCP adapter — turn GOAT actions into MCP tools with one call.
 *
 * `toMcpTools` is re-exported from @goatnetwork/agentkit; `TIAGOH_GOAT_ACTIONS`
 * bundles x402 + ERC-8004 so any tiagoh package can expose them as paid MCP
 * tools without re-wiring the on-chain plumbing.
 */
import { toMcpTools } from "@goatnetwork/agentkit";
import { X402_ACTIONS } from "./x402.js";
import { ERC8004_ACTIONS } from "./erc8004.js";

export { toMcpTools };

/** x402 + ERC-8004, ready to pass to `toMcpTools(...)`. */
export const TIAGOH_GOAT_ACTIONS = [...X402_ACTIONS, ...ERC8004_ACTIONS];
