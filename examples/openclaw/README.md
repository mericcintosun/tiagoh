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
        └── just calls the tool ──────────────────────────  settled on GOAT with Bitcoin finality)
```

The agent calls a tool like any other; tiagoh serves the tools over HTTP and prices each call in
x402. The tools are also listed in the **ClawUp MCP marketplace** (submission id: `tiagoh`), so any
ClawUp agent can attach them with one click.

## Setup

**Option A — ClawUp marketplace (no config):** in ClawUp → **Tools → Marketplace**, find `tiagoh`
and **Add to Agent**.

**Option B — register the endpoint directly:** drop the `mcp.servers` block from
[`openclaw.json`](./openclaw.json) into `~/.openclaw/openclaw.json`, or run:

```bash
openclaw mcp add tiagoh \
  --url https://tiagoh.vercel.app/api/mcp \
  --transport streamable-http
```

**Add the skill** so the agent uses paid tools wisely (budget, reputation, disputes): copy
[`skills/tiagoh-payments.md`](./skills/tiagoh-payments.md) into your OpenClaw skills directory.

## Result

Your ClawUp/OpenClaw agent can now say *"analyze this DeFi position"* and autonomously call the paid
tiagoh tools it needs — priced per call over x402, with every receipt anchored on GOAT and bad
outputs refundable via tiagoh's dispute + quality-bond layer.
