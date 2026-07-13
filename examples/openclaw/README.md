# tiagoh × OpenClaw / ClawUp

Give an **OpenClaw** agent (deployed in seconds on **[ClawUp](https://x.com/ClawUpAI)**, the
managed OpenClaw platform on GOAT) the ability to discover, pay for, and *trust* paid MCP tools
through tiagoh — per call over x402, under a fixed budget, on GOAT Network.

OpenClaw is a first-class MCP host, so tiagoh plugs straight in.

## How it fits

```
OpenClaw agent (on ClawUp)  ──MCP──▶  tiagoh connect (stdio bridge)  ──x402──▶  tiagoh gateway ──▶ paid MCP tool
        │                                    │  answers 402 challenges                 │  charge-on-success
        │                                    │  under a spending budget                │  receipt anchored on GOAT
        └── just calls the tool ─────────────┘                                         └── settled with Bitcoin finality
```

The agent calls a tool like any other; **`tiagoh connect`** sits in between and pays each x402
challenge automatically, aborting before signing if a call would breach the agent's budget. The
OpenClaw agent never has to understand payments — it just gets trustworthy, insured tools.

## Setup

**1. Run a paid tiagoh gateway** (the seller side — wraps any MCP server behind an x402 paywall):

```bash
npx tiagoh init          # writes tiagoh.config.json (upstream, payTo, asset, per-tool prices)
npx tiagoh wrap          # your MCP server is now paid at http://localhost:4402/mcp
```

**2. Register tiagoh with your OpenClaw agent** — point OpenClaw at the `tiagoh connect` bridge
(it answers the 402s under a budget), either via the CLI:

```bash
openclaw mcp add tiagoh \
  --command npx \
  --arg tiagoh --arg connect --arg http://localhost:4402/mcp \
  --env TIAGOH_KEY_PATH=./agent.pem \
  --env TIAGOH_MAX_SESSION=5000000000 \
  --env GOAT_RPC_URL=https://rpc.testnet3.goat.network
```

…or by dropping the config in `~/.openclaw/openclaw.json` — see [`openclaw.json`](./openclaw.json).

**3. Add the skill** so the agent uses paid tools wisely (budget, reputation, disputes): copy
[`skills/tiagoh-payments.md`](./skills/tiagoh-payments.md) into your OpenClaw skills directory.

**4. Deploy on ClawUp** — push the same agent config (MCP server + skill) to your ClawUp workspace
to launch the agent in seconds on GOAT-secured infrastructure.

## Result

Your ClawUp/OpenClaw agent can now say *"analyze this DeFi position"* and autonomously buy the paid
tiagoh tools it needs — market data, RWA prices, yields, a composite analysis — paying per call over
x402 under a fixed budget, with every receipt anchored on GOAT and bad outputs refundable via
tiagoh's dispute + quality-bond layer.
