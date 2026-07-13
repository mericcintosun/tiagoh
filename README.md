<div align="center">

# tiagoh

**The insured settlement & trust layer for the agent economy — on Bitcoin.**

Turn any MCP server into a paid, **insured**, **reputation-ranked** service. AI agents pay per tool
call over x402; payments **cascade** through multi-hop supply chains with on-chain budget caps and
recursive revenue splits; every tool stakes a **quality bond** slashed on bad output; broken cascades
**unwind atomically** via BitVM2-arbitrated escrow; tools compete in live **reverse auctions**; and
everything anchors to portable **ERC-8004 reputation** — settled with **Bitcoin finality on GOAT
Network**.

GOAT Network · AI Builder Grants 2026 · *the first trust layer for paid MCP tools on GOAT*

</div>

---

## What this is

tiagoh is the trust layer for paid MCP tools on GOAT Network — a Bitcoin L2 that is 100%
EVM-compatible and built for the AI agent economy (GOAT AgentKit ships x402 + ERC-8004 + `.goat`
naming + agent discovery natively). tiagoh adds the layer above those rails that makes autonomous,
machine-to-machine commerce actually trustworthy.

Two halves:

- **The monetization core** — `tiagoh wrap` turns any MCP server into a paid tool over x402;
  payments cascade through multi-hop supply chains; every settled call is anchored on-chain with its
  cascade parent; revenue splits between co-authors; an autonomous LLM buyer discovers, prices, and
  buys tools under a fixed budget.
- **The trust layer** — five features our research confirmed are unbuilt on GOAT:

| # | Feature | Why it matters |
| --- | --- | --- |
| 1 | **Reputation & receipt-driven discovery** | rank tools by *proven* quality, not marketing (ERC-8004) |
| 2 | **Quality bonds & SLA insurance** | charge-on-**quality**: bad output → auto-refund + slash |
| 3 | **Cascading payments + agent-hires-agent delegation** | budget-tree caps + recursive revenue attribution |
| 4 | **Escrow, dispute & atomic multi-hop refund** | a broken cascade unwinds cleanly — *unbuilt anywhere* |
| 5 | **Live tool auction & dynamic pricing** | tools bid to serve a request — *whitespace across x402* |

## Docs

- **[PRD.md](docs/PRD.md)** — full product requirements: features, contracts, architecture,
  milestones, metrics, risks.
- **[VISION.md](docs/VISION.md)** — why the agent economy needs a trust layer, why Bitcoin/GOAT, the
  wedge → moat → platform, and the bet.
- **[DESIGN.md](docs/DESIGN.md)** — the "Vault" design system: color palette, tokens, shadcn/ui
  component inventory, and the layout map (frontend spec).

## Run the demos

```bash
pnpm install && pnpm -r --filter "./packages/**" build

# End-to-end x402 flow (local mock facilitator): per-call payment, charge-on-success,
# a 3-hop cascade, and pre-sign budget rejection.
pnpm --filter @tiagoh/e2e demo

# Same flow, anchoring REAL receipts to ReceiptRegistry on GOAT Testnet3:
TIAGOH_ONCHAIN=1 PRIVATE_KEY=0x… pnpm --filter @tiagoh/e2e demo

# The autonomous buyer driving the live gateway (discover → decide → pay → synthesize).
# Defaults to a labeled offline simulation; TIAGOH_AGENT_LIVE=1 + ANTHROPIC_API_KEY runs live Claude.
pnpm --filter @tiagoh/e2e agent

# Contracts
pnpm contracts:setup && pnpm contracts:test        # 16/16
pnpm contracts:deploy                              # deploy to GOAT testnet
```

## Positioning (honest)

We aim to be **first on GOAT** on all five features, and **world-first** on the one that only makes
sense once payments compose into trees: the **atomic, insured cascade**. We build *on* the rails
(x402 for payment, ERC-8004 for identity, GOAT/BitVM2 for settlement) — tiagoh is the trust logic in
between.

## Tech

TypeScript (Node 20, pnpm workspaces), Next.js 15 + shadcn/ui, `@modelcontextprotocol/sdk`, x402
(ERC-3009 / Permit2), Solidity + Foundry, ERC-8004, ERC-4337, GOAT Network testnet, Claude Opus 4.8.
