import type { BudgetGuard } from "./budget.js";

/**
 * stdio bridge for `tiagoh connect`: lets any MCP host (Claude Code, Claude
 * Desktop, Cursor, OpenClaw/ClawUp) call paid servers, answering 402 challenges
 * automatically under a spending budget. See examples/openclaw for the ClawUp setup.
 *
 * The bridge speaks MCP over stdio to the host and forwards tools/call to the
 * remote paid gateway via the paying fetch. Wiring to @modelcontextprotocol/sdk
 * StdioServerTransport is the integration point.
 */
export interface BridgeOptions {
  gatewayUrl: string;
  budget: BudgetGuard;
  sign: (challenge: { priceUsd: number; asset: string }) => Promise<string>;
}

export async function startStdioBridge(_opts: BridgeOptions): Promise<void> {
  // TODO: connect a StdioServerTransport to the host and proxy tools/list +
  // tools/call through createPayingFetch(). Kept as the integration point so the
  // package builds without a live MCP host.
  throw new Error("startStdioBridge: wire StdioServerTransport (integration point)");
}
