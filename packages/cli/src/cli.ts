import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { TIAGOH, TiagohConfigSchema } from "@tiagoh/core";

const program = new Command();

program.name("tiagoh").description("Monetize any MCP server on GOAT Network — x402, insured, reputation-ranked.").version("0.1.0");

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

program
  .command("wrap")
  .description("put an x402 paywall in front of the MCP server in tiagoh.config.json")
  .action(() => {
    console.log("tiagoh wrap: start the gateway from @tiagoh/gateway (integration point).");
  });

program
  .command("connect")
  .argument("<gatewayUrl>", "URL of a paid tiagoh gateway")
  .description("stdio bridge so an MCP host can call paid servers under a budget")
  .action((gatewayUrl: string) => {
    console.log(`tiagoh connect ${gatewayUrl}: start the stdio bridge from @tiagoh/client (integration point).`);
  });

program.parse();
