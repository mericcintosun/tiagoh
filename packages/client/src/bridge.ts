import type { BudgetGuard } from "./budget.js";
import { listPaidTools, callPaidTool } from "./caller.js";

export interface BridgeOptions {
  /** Base URL of the paid tiagoh gateway to bridge. */
  gatewayUrl: string;
  budget: BudgetGuard;
  /** Signs the x402 authorization for a 402 challenge. */
  sign: (challenge: { priceUsd: number; asset: string }) => Promise<string>;
  payer?: string;
}

/**
 * stdio bridge for `tiagoh connect`: exposes a remote paid gateway's tools to any
 * MCP host (Claude Code, Claude Desktop, Cursor) as a local stdio MCP server,
 * paying each x402 challenge automatically under a budget. Free to run — the only
 * cost is the x402 micropayment to the tool seller, never to the MCP host/LLM.
 */
export async function startStdioBridge(opts: BridgeOptions): Promise<void> {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );

  const server = new Server(
    { name: "tiagoh-connect", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await listPaidTools(opts.gatewayUrl);
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: { type: "object", properties: {} },
        _meta: t._meta,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req: { params: { name: string; arguments?: unknown } }) => {
    const { result } = await callPaidTool(opts.gatewayUrl, req.params.name, req.params.arguments ?? {}, {
      budget: opts.budget,
      sign: opts.sign,
      payer: opts.payer ?? "mcp-host",
    });
    return {
      content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
    };
  });

  await server.connect(new StdioServerTransport());
}
