<div align="center">

# tiagoh

**Get paid per call for your MCP tools. AI agents pay in x402, settled on Bitcoin through GOAT Network.**

[Live demo](https://tiagoh.vercel.app) · [MCP endpoint](https://tiagoh.vercel.app/api/mcp) · [Deployments](docs/DEPLOYMENTS.md) · [x402 spec](docs/x402-mcp-spec.md)

GOAT Network AI Builder Grants 2026

</div>

---

## What it is

Thousands of MCP servers give AI agents tools, and almost all of them are free, because there is no
clean way to charge an autonomous agent per call. tiagoh fixes that and adds the parts raw x402 leaves
out.

Put a paywall in front of any MCP server with one command. Agents pay per tool call in x402. When a
paid tool buys from other paid tools, the payments form a tree with a single budget cap and revenue
that flows up the chain. Every tool can stake a bond that gets slashed for bad output. Broken calls
get disputed and refunded. Tools compete in reverse auctions. Reputation is built from real receipts,
not marketing. Everything settles on GOAT Network with Bitcoin finality.

## What is live right now

- **10 Solidity contracts on GOAT Testnet3**, each exercised with real transactions, plus an
  ERC-4337 session-key enforcer and a BitVM2 optimistic arbiter in source. 23 of 23 tests passing.
  See [DEPLOYMENTS.md](docs/DEPLOYMENTS.md).
- **End to end x402 flow**: gateway answers 402, the client pays under budget, the tool runs, and only
  a successful call is billed. Run it with `pnpm --filter @tiagoh/e2e demo`.
- **Autonomous buyer** that reads reputation, pays per call, verifies each output, and disputes bad
  ones. Run it with `pnpm --filter @tiagoh/e2e agent`.
- **Live dashboard** at [tiagoh.vercel.app](https://tiagoh.vercel.app) that reads the deployed
  contracts client side, no backend.
- **Hosted MCP endpoint** at [/api/mcp](https://tiagoh.vercel.app/api/mcp), listed in the ClawUp MCP
  marketplace, usable by any OpenClaw or ClawUp agent.

## Features

| Feature | What it does |
| --- | --- |
| Wrap | `tiagoh wrap` puts an x402 paywall in front of any MCP server, unchanged |
| Cascade | multi hop payments with one budget cap and recursive revenue attribution |
| Quality bonds | a tool stakes a bond, slashed to refund the buyer on bad output |
| Escrow and dispute | conditional payment, atomic multi hop refund, buyer favorable ruling |
| Reputation | on chain score built from real receipts, refunds, and slashes |
| Reverse auction | tools bid to serve a request, best price or reputation weighted wins |
| Delegation | an agent grants another a capped, sub delegatable spend budget |
| Receipts | every settled call anchored on chain with its cascade parent link |

## Run the demos

```bash
pnpm install && pnpm -r --filter "./packages/**" build

# End to end x402 flow: per call payment, charge on success, a 3 hop cascade, budget rejection
pnpm --filter @tiagoh/e2e demo

# Same flow, anchoring real receipts to ReceiptRegistry on GOAT Testnet3
TIAGOH_ONCHAIN=1 PRIVATE_KEY=0x… pnpm --filter @tiagoh/e2e demo

# Autonomous buyer: discover, read reputation, pay, verify, dispute bad output
pnpm --filter @tiagoh/e2e agent

# Contracts
pnpm contracts:setup && pnpm contracts:test    # 23/23
```

Full reviewer path: [docs/testing-playbook.md](docs/testing-playbook.md).

## Architecture

```
MCP host or agent  ──call──▶  tiagoh gateway  ──402, pay, run──▶  your MCP server
    (pays x402)               (charge on success)                 (unchanged)
                                     │
                                     ▼
                         GOAT Testnet3 contracts
   ReceiptRegistry · CascadeController · QualityBond · EscrowVault · DisputeArbiter
   ReputationScorer · ToolAuction · AgentRegistry · RevenueSplit · PaymentChannel
```

| Path | What |
| --- | --- |
| `packages/gateway` | seller side: wrap, price, run the x402 flow, charge on success |
| `packages/client` | buyer side: paying fetch, budget guard, stdio bridge for MCP hosts |
| `packages/agent` | autonomous buyer: reads reputation, verifies output, disputes |
| `packages/goat` | GOAT foundation: x402 and ERC-8004 (AgentKit), viem clients, on chain settle |
| `packages/cli` | `tiagoh` CLI: init, wrap, connect, call |
| `contracts` | Solidity (Foundry): the 10 contracts, tests, deploy script |
| `apps/dashboard` | Next.js dashboard, reads chain client side |
| `tools/e2e` | runnable end to end demo |

## Docs

- [PRD.md](docs/PRD.md), [VISION.md](docs/VISION.md), [DESIGN.md](docs/DESIGN.md)
- [DEPLOYMENTS.md](docs/DEPLOYMENTS.md): contract addresses and exercised transactions
- [x402-mcp-spec.md](docs/x402-mcp-spec.md): the wire conventions
- [testing-playbook.md](docs/testing-playbook.md): how to verify it works

## Honest scope

Payment signing in the demos is a local mock. Real settlement through GOAT's hosted x402 facilitator
needs the x402 Integration Faucet token, and lands as a one line swap
(`createFacilitatorSettle` in `@tiagoh/goat`). Everything else, including the on chain receipts, is
real on testnet.

## Tech

TypeScript, Node 20, pnpm workspaces. Next.js 15 and shadcn/ui. `@modelcontextprotocol/sdk`. x402
with ERC-3009. Solidity with Foundry. ERC-8004. GOAT Network testnet. Claude Opus 4.8 for the buyer.
