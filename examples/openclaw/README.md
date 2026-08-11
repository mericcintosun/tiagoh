# tiagoh × OpenClaw / ClawUp

Give an **OpenClaw** agent (deployed in seconds on **[ClawUp](https://clawup.org)**, the managed
OpenClaw platform on GOAT) the ability to call tiagoh's paid MCP tools — GOAT/BTC market data, RWA
prices, DeFi yields — priced per call over x402 on GOAT Network.

OpenClaw is a first-class MCP host, so tiagoh plugs straight in over its **hosted, streamable-HTTP
MCP endpoint** — no local bridge to run.

## How it fits

```
OpenClaw agent (on ClawUp)  ──MCP (streamable-http)──▶  https://tiagoh.vercel.app/api/mcp
        │                                                 (tiagoh paid tools; x402-priced,
        └── just calls the tool ──────────────────────────  settled per call in USDC.e on GOAT)
```

The agent calls a tool like any other; tiagoh serves the tools over HTTP and prices each call in
x402. Two tools are free, so an agent gets something useful before any payment question arises.

## Setup

**Register the endpoint directly:** drop the `mcp.servers` block from
[`openclaw.json`](./openclaw.json) into `~/.openclaw/openclaw.json`, or run:

```bash
openclaw mcp add tiagoh-goat-data \
  --url https://tiagoh.vercel.app/api/mcp \
  --transport streamable-http
```

**Add the skill** so the agent uses paid tools wisely (budget, reputation, disputes): copy
[`skills/tiagoh-payments.md`](./skills/tiagoh-payments.md) into your OpenClaw skills directory.

## Result

Your agent can call the tiagoh tools it needs, priced per call over x402, with every settlement
anchored on GOAT.

## What paying actually requires

An agent needs a key to sign the ERC-3009 authorization — a host that only forwards tool calls can
use the two free tools but cannot buy the paid ones. That is a property of the host, not of the
endpoint: payment travels as tool arguments (`_payer`, `_challenge`, `_payment`) as well as headers,
so nothing but the signature is missing.

A ClawUp marketplace listing is the intended distribution path: `tiagoh-goat-data` is submitted and
pending review. Once it is approved and public, an agent can attach it from **Tools → Marketplace**
with no config at all — the server key above matches that name so both install paths agree.
