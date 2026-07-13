import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { TIAGOH, TiagohConfigSchema, type TiagohConfig } from "@tiagoh/core";
import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, listPaidTools, callPaidTool } from "@tiagoh/client";

const program = new Command();
program
  .name("tiagoh")
  .description("Monetize any MCP server on GOAT Network — x402, insured, reputation-ranked.")
  .version("0.1.0");

// ── init ─────────────────────────────────────────────────────────────────────
program
  .command("init")
  .description("write a tiagoh.config.json scaffold")
  .action(() => {
    const config = TiagohConfigSchema.parse({
      upstream: { command: "node", args: ["./my-mcp-server.js"] },
      payTo: "0x0000000000000000000000000000000000000000",
      asset: "0x0000000000000000000000000000000000000000",
      chainId: TIAGOH.DEFAULT_CHAIN_ID,
      port: TIAGOH.DEFAULT_PORT,
      tools: [{ name: "example_tool", priceUsd: 0.02, description: "an example paid tool" }],
    });
    writeFileSync("tiagoh.config.json", JSON.stringify(config, null, 2));
    console.log("✓ wrote tiagoh.config.json — edit upstream, payTo, asset, and per-tool prices.");
  });

// ── wrap: start the paid gateway over any MCP server ─────────────────────────
program
  .command("wrap")
  .description("put an x402 paywall in front of the MCP server in tiagoh.config.json")
  .option("-c, --config <path>", "config file", "tiagoh.config.json")
  .action(async (opts: { config: string }) => {
    const config: TiagohConfig = TiagohConfigSchema.parse(
      JSON.parse(readFileSync(opts.config, "utf8")),
    );

    // Spawn the upstream MCP server (stdio) and proxy its tools.
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "tiagoh-gateway", version: "0.1.0" }, { capabilities: {} });
    await client.connect(
      new StdioClientTransport({ command: config.upstream.command, args: config.upstream.args }),
    );

    const gateway = new TiagohGateway({
      config,
      listUpstream: async () => {
        const { tools } = (await client.listTools()) as { tools: Array<{ name: string; description?: string }> };
        return tools.map((t) => ({ name: t.name, description: t.description }));
      },
      callUpstream: async (tool, args) => {
        const res = await client.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> });
        return res;
      },
      // Local mock facilitator by default; a real facilitator/on-chain settle is a swap-in
      // (see @tiagoh/goat createOnchainSettle / createFacilitatorSettle).
      settle: async ({ tool }) => ({ txHash: `mock:${tool}`, payee: config.payTo }),
    });

    gateway.serve(config.port);
    console.log(`✓ tiagoh gateway serving on http://localhost:${config.port}`);
    console.log(`  discovery: http://localhost:${config.port}${TIAGOH.DISCOVERY_PATH}`);
    console.log(`  wrapping:  ${config.upstream.command} ${config.upstream.args.join(" ")}`);
    console.log(`  priced tools: ${config.tools.map((t) => `${t.name}($${t.priceUsd})`).join(", ")}`);
  });

// ── connect: call a paid tool on a gateway, answering 402 under budget ───────
program
  .command("connect")
  .argument("<gatewayUrl>", "base URL of a paid tiagoh gateway")
  .argument("[tool]", "tool to call (omit to list priced tools)")
  .argument("[argsJson]", "JSON arguments for the tool", "{}")
  .description("discover or call paid tools on a gateway, paying x402 under a budget")
  .action(async (gatewayUrl: string, tool: string | undefined, argsJson: string) => {
    if (!tool) {
      const tools = await listPaidTools(gatewayUrl);
      console.log("priced tools:");
      for (const t of tools) console.log(`  ${t.name.padEnd(22)} $${t._meta?.tiagoh?.priceUsd ?? 0}`);
      return;
    }
    const budget = new BudgetGuard(Number(process.env.TIAGOH_MAX_SESSION ?? "5"));
    const sign = async (c: { priceUsd: number }) => `sig:${c.priceUsd}`; // real x402 sig when facilitator is wired
    const { result, receipt } = await callPaidTool(gatewayUrl, tool, JSON.parse(argsJson), {
      budget,
      sign,
      payer: "cli",
    });
    console.log(`✓ paid ${tool} $${receipt.amountUsd} · receipt ${receipt.paymentId}`);
    console.log(JSON.stringify(result, null, 2));
  });

program.parse();
