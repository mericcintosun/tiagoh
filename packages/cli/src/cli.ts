import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { TIAGOH, TiagohConfigSchema, formatMinor, toMinor, type TiagohConfig } from "@tiagoh/core";
import { TiagohGateway } from "@tiagoh/gateway";
import { BudgetGuard, listPaidTools, callPaidTool, startStdioBridge } from "@tiagoh/client";

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
      assetDecimals: 6,
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

    // Real x402 settlement when a facilitator is configured (config.facilitatorUrl); otherwise a
    // local mock so the demo runs without a live facilitator. The private key (for anchoring
    // receipts on-chain) comes from env and is never written to config.
    const pk = process.env.TIAGOH_PRIVATE_KEY as `0x${string}` | undefined;
    const receiptRegistry = process.env.RECEIPT_REGISTRY_ADDRESS as `0x${string}` | undefined;
    const scorerAddress = process.env.REPUTATION_SCORER_ADDRESS as `0x${string}` | undefined;
    let settle: ConstructorParameters<typeof TiagohGateway>[0]["settle"];
    let verifyPayment: ConstructorParameters<typeof TiagohGateway>[0]["verifyPayment"];
    let cosign: ConstructorParameters<typeof TiagohGateway>[0]["cosign"];
    let onReceipt: ConstructorParameters<typeof TiagohGateway>[0]["onReceipt"];

    // Counter-sign receipts whenever a signer and a registry are configured. Without this the
    // gateway's receipts are its own unilateral claim, which no arbiter will act on — so the
    // seller looks trustworthy and the buyer quietly has no recourse.
    if (pk && receiptRegistry) {
      const goat = await import("@tiagoh/goat");
      cosign = goat.createGatewayCosigner({
        privateKey: pk,
        registry: receiptRegistry,
        chainId: config.chainId,
        token: config.asset as `0x${string}`,
      });
      const anchor = goat.createReceiptAnchor({
        privateKey: pk,
        registry: receiptRegistry,
        token: config.asset as `0x${string}`,
      });
      // Reputation is written from settled calls, not from a hardcoded table.
      const reporter = scorerAddress
        ? goat.createScoreReporter({ privateKey: pk, scorer: scorerAddress })
        : undefined;

      onReceipt = (receipt) => {
        void (async () => {
          if (!receipt.payerSignature || !receipt.payeeSignature) return; // telemetry only
          try {
            await anchor(receipt);
            await reporter?.recordSuccess({
              tool: receipt.tool,
              seller: receipt.payee as `0x${string}`,
              volume: BigInt(receipt.amount),
              payer: receipt.payer,
            });
          } catch (err) {
            console.error(`  ! could not anchor receipt ${receipt.paymentId}: ${String(err)}`);
          }
        })();
      };
      console.log(`  receipts: co-signed + anchored to ${receiptRegistry}`);
    } else {
      console.log("  receipts: NOT co-signed (set TIAGOH_PRIVATE_KEY + RECEIPT_REGISTRY_ADDRESS)");
      console.log("    buyers of this gateway cannot open a dispute against it.");
    }

    if (config.facilitatorUrl) {
      const goat = await import("@tiagoh/goat");
      const facilitator = {
        facilitatorUrl: config.facilitatorUrl,
        payTo: config.payTo as `0x${string}`,
        asset: config.asset as `0x${string}`,
        network: `goat:${config.chainId}`,
        apiKey: process.env.X402_FACILITATOR_KEY,
        // Anchor the settled call on-chain when a signer is available.
        anchor:
          pk && receiptRegistry
            ? goat.createOnchainSettle({
                privateKey: pk,
                receiptRegistry,
                token: config.asset as `0x${string}`,
                payee: config.payTo as `0x${string}`,
              })
            : undefined,
      };
      verifyPayment = goat.createFacilitatorVerify(facilitator);
      settle = goat.createFacilitatorSettle(facilitator);
      console.log(`  x402 facilitator: ${config.facilitatorUrl} (verify + settle live)`);
    } else {
      settle = async ({ tool }) => ({ txHash: `mock:${tool}`, payee: config.payTo });
      console.log("  x402 facilitator: none (MOCK settle, payments are NOT real)");
      console.log("  ⚠ payment verification is disabled — anyone can call priced tools for free.");
      console.log("    Set facilitatorUrl in tiagoh.config.json before serving anything real.");
    }

    const gateway = new TiagohGateway({
      config,
      // Without a facilitator there is nothing to verify against, so the gateway would refuse
      // to start. Opting in explicitly keeps "this is a demo" a visible decision rather than a
      // silent default that gives paid work away.
      allowUnverifiedPayments: !config.facilitatorUrl,
      listUpstream: async () => {
        const { tools } = (await client.listTools()) as { tools: Array<{ name: string; description?: string }> };
        return tools.map((t) => ({ name: t.name, description: t.description }));
      },
      callUpstream: async (tool, args) => {
        const res = await client.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> });
        return res;
      },
      verifyPayment,
      settle,
      cosign,
      onReceipt,
    });

    gateway.serve(config.port);
    console.log(`✓ tiagoh gateway serving on http://localhost:${config.port}`);
    console.log(`  discovery: http://localhost:${config.port}${TIAGOH.DISCOVERY_PATH}`);
    console.log(`  wrapping:  ${config.upstream.command} ${config.upstream.args.join(" ")}`);
    console.log(
      `  priced tools: ${config.tools
        .map((t) => `${t.name}(${formatMinor(toMinor(t.priceUsd, config.assetDecimals), config.assetDecimals)})`)
        .join(", ")}`,
    );
  });

// ── connect: stdio bridge so an MCP host can call a paid gateway ─────────────
program
  .command("connect")
  .argument("<gatewayUrl>", "base URL of a paid tiagoh gateway")
  .description("stdio bridge: expose a paid gateway's tools to an MCP host, paying x402 under a budget")
  .action(async (gatewayUrl: string) => {
    // NOTE: speaks MCP over stdout — do not print anything here.
    const budget = new BudgetGuard(toMinor(process.env.TIAGOH_MAX_SESSION ?? "5"));
    // Placeholder authorization: real x402 signing arrives with the payer wallet adapter
    // (EvmPayerWalletAdapter in @tiagoh/goat). A gateway with a live facilitator rejects this.
    const sign = async (c: { nonce: string }) => `mock-sig:${c.nonce}`;
    await startStdioBridge({ gatewayUrl, budget, sign, payer: "mcp-host" });
  });

// ── call: one-shot paid tool call (or list) from the terminal ───────────────
program
  .command("call")
  .argument("<gatewayUrl>", "base URL of a paid tiagoh gateway")
  .argument("[tool]", "tool to call (omit to list priced tools)")
  .argument("[argsJson]", "JSON arguments for the tool", "{}")
  .description("call or list paid tools once, paying x402 under a budget")
  .action(async (gatewayUrl: string, tool: string | undefined, argsJson: string) => {
    if (!tool) {
      const tools = await listPaidTools(gatewayUrl);
      console.log("priced tools:");
      for (const t of tools) {
        const meta = t._meta?.tiagoh;
        const price = meta ? formatMinor(BigInt(meta.amount), meta.assetDecimals) : "0";
        console.log(`  ${t.name.padEnd(22)} ${price}`);
      }
      return;
    }
    const budget = new BudgetGuard(toMinor(process.env.TIAGOH_MAX_SESSION ?? "5"));
    const sign = async (c: { nonce: string }) => `mock-sig:${c.nonce}`;
    const { result, receipt } = await callPaidTool(gatewayUrl, tool, JSON.parse(argsJson), {
      budget,
      sign,
      payer: "cli",
    });
    const paid = formatMinor(BigInt(receipt.amount), receipt.assetDecimals);
    console.log(`✓ paid ${tool} ${paid} · receipt ${receipt.paymentId}`);
    console.log(JSON.stringify(result, null, 2));
  });

program.parse();
