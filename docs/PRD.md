# tiagoh — Product Requirements Document

> **tiagoh** is the *insured settlement & trust layer for the agent economy, on Bitcoin.*
> Turn any MCP server into a paid, **insured**, **reputation-ranked** service. AI agents pay per
> tool call over x402; payments **cascade** through multi-hop supply chains with on-chain budget
> caps and recursive revenue splits; every tool stakes a **quality bond** that is slashed on bad
> output; broken cascades **unwind atomically** through BitVM2-arbitrated escrow; tools compete in
> live **reverse auctions**; and everything anchors to portable **ERC-8004 reputation** — all
> settled with **Bitcoin finality on GOAT Network**.

- **Status:** Draft v0.1
- **Owner:** meric (mericcintosun)
- **Target program:** GOAT Network — AI Builder Grants / OpenClaw Summer Builder Bootcamp 2026

---

## 1. Summary

tiagoh is built for **GOAT Network** — a Bitcoin Layer-2 that is 100% EVM-compatible and explicitly
building for the AI agent economy (GOAT AgentKit ships x402 payments, ERC-8004 identity, `.goat`
naming, and agent discovery natively). tiagoh introduces a new machine-to-machine primitive —
**budget-bounded cascading payments with recursive revenue attribution** for paid MCP tools over
x402 — and wraps it in the **trust guarantees** the raw payment rails still lack.

Our research confirmed that on GOAT, and largely across the entire x402 ecosystem, the following are
**not yet built**: (1) receipt-driven **reputation ranking of paid tools**, (2) staked **quality
bonds / SLA insurance** for tools, (3) **multi-hop cascade** payments and capped **agent-hires-agent
delegation**, (4) **escrow + atomic multi-hop refund / dispute** (x402 is fire-and-forget; refunds
are explicitly a "future spec"), and (5) competitive **reverse auctions / dynamic price discovery**
for tool calls. tiagoh ships all five on top of a monetization core — a **first-on-GOAT**,
defensible, demo-friendly stack.

**One-liner (for the application form):**
> *tiagoh is the trust layer for paid MCP tools on GOAT: agents pay per call over x402, payments
> cascade through insured, reputation-ranked supply chains, and any broken hop unwinds atomically —
> settled with Bitcoin finality.*

---

## 2. Problem

1. **Agents can't pay like humans.** Thousands of MCP servers expose tools to AI agents, but almost
   all are free because there is no clean way to charge an autonomous agent per call. x402 fixes the
   payment primitive.
2. **x402 alone is a vending machine.** Every x402 tool today is point-to-point and fire-and-forget:
   an agent pays, the server answers, done. There is **no composition** (a tool that itself buys
   from other paid tools), **no recourse** (the payment is irreversible even if the output is
   garbage — confirmed by Coinbase's own x402 FAQ), **no quality guarantee**, **no trust signal**
   beyond marketing, and **no price discovery** (prices are static and provider-set).
3. **GOAT has the rails but not the trust layer.** GOAT AgentKit natively does x402 + ERC-8004
   identity + discovery, but ships **no** cascade, delegation, bonding/slashing, escrow/dispute, or
   competitive marketplace. The ERC-8004 spec itself leaves reputation *scoring*, *validation
   slashing*, disputes, and refunds explicitly **out of scope** — deliberately open for an app layer.

**Thesis:** the agent economy needs a *trust* layer, not just a *payment* layer. tiagoh is that
layer, and Bitcoin-grade finality is what makes multi-hop, insured settlement credible.

---

## 3. Goals & non-goals

### Goals
- **G1 — Ship the monetization core on GOAT (EVM).** Wrap any MCP server behind an x402 paywall;
  per-tool pricing; charge-on-success; on-chain receipts; revenue splits; prepaid channels; the
  autonomous LLM buyer; the live dashboard/explorer/playground.
- **G2 — Ship the five trust features** (see §5) as first-on-GOAT primitives.
- **G3 — Be verifiable on-chain.** Every headline claim backed by a GOAT testnet transaction and a
  block-explorer link.
- **G4 — Be demo-able.** A live dashboard where a judge watches a cascade settle, a bond get slashed
  and auto-refund, and an auction clear — in real time.
- **G5 — Lean on GOAT-native primitives** (ERC-8004, x402 DELEGATE settlement, ERC-4337 session
  keys, BitVM2 fraud-proofs, Bitcoin finality, `.goat` naming) so the work is on-brand and
  defensible, not a portable pattern in GOAT paint.

### Non-goals (for the hackathon window)
- Not building a new payment protocol — tiagoh builds **on** x402, it does not reimplement it.
- Not a general L2 or bridge — we consume GOAT's settlement, we don't rebuild it.
- Not mainnet launch or token — testnet-first; monetization (protocol take-rate) is post-hackathon.
- Not a human-facing marketplace UI polish beyond what a judge needs to see it work.

---

## 4. Users & personas

| Persona | Who | Job-to-be-done | Primary surface |
| --- | --- | --- | --- |
| **Tool seller** | Dev who owns an MCP server / API | Monetize it per call, prove quality, earn trust, split revenue with co-authors | `tiagoh wrap`, seller dashboard, bond manager |
| **Composer** | Dev whose paid tool buys other paid tools | Resell a composite tool, earn margin up the cascade, cap downstream spend | gateway + client, cascade view |
| **Buyer agent** | An autonomous AI agent (or its operator) | Discover, price, buy, and *trust* tools under a fixed budget; get refunded when a tool underdelivers | `tiagoh connect`, `@tiagoh/agent`, marketplace/auction |
| **Reviewer / judge** | GOAT grant reviewer | Verify it actually works, on-chain, in minutes | dashboard, explorer, testing playbook, tx links |
| **Ecosystem** | Other x402 / MCP builders | Adopt the wire conventions (priced discovery, cascade attribution, bond/reputation) | published spec + SDK |

---

## 5. Product pillars & features

tiagoh = **the monetization core** + **five trust features (the gap we researched)**.

### 5.0 Core (on GOAT / EVM) — the monetization foundation

| ID | Feature | Requirement |
| --- | --- | --- |
| C1 | **Wrap** (`tiagoh wrap`) | Put an x402 paywall in front of any existing MCP server, unchanged. Per-tool price advertised in `tools/list` (`_meta.tiagoh.priceUsd`). |
| C2 | **Connect** (`tiagoh connect`) | stdio bridge so any MCP host (Claude Code, Claude Desktop, Cursor, **OpenClaw/ClawUp**) calls paid servers, answering 402 challenges automatically under a spending budget. See `examples/openclaw`. |
| C3 | **Cascade** | When a paid tool buys from other paid tools, compose payments into a linked tree (see 5.3). |
| C4 | **Charge-on-success** | The gateway settles payment **only if the tool call succeeds**; a failed call is never billed. |
| C5 | **On-chain receipts** | Every settled call anchored with its cascade `parentId`; the full graph reconstructs from chain data alone. |
| C6 | **Revenue splits** | A server's `payTo` can point at a splitter contract; earnings split between payees by fixed weights, pull-based, on-chain. |
| C7 | **Prepaid channels** | Deposit once, authorize usage off-chain with signed vouchers, redeem/reclaim on-chain — for high-frequency traffic. |
| C8 | **Autonomous buyer** (`@tiagoh/agent`) | Claude (Opus 4.8) discovers priced tools, decides what to buy for a goal, pays x402 per call under a fixed budget, adapts when rejected, and cites the data it purchased. |
| C9 | **Discovery** | Every gateway serves a Bazaar-compatible catalog at `/.well-known/x402.json`. |
| C10 | **Dashboard / explorer / playground** | Live revenue, receipts (with explorer settlement links), the cascade graph, and an interactive cascade playground. |

> **Native stack:** GOAT is EVM, so contracts are **Solidity** (Foundry); the payment token is an
> **ERC-3009 (`transferWithAuthorization`) / Permit2** stablecoin settled by GOAT's x402 facilitator;
> identity uses **ERC-8004**; sub-budgets can use **ERC-4337** session keys.

---

### 5.1 Feature — **Reputation & receipt-driven discovery** *(gap #1)*

**Verdict from research:** `NOT_DONE_ON_GOAT`. The ERC-8004 **Reputation Registry is already
deployed on GOAT** (`0x8004…`) but is only a raw signed-signal store — no scoring, ranking, or
tool-level quality layer exists; the spec explicitly leaves aggregation to the app layer. Coinbase's
Bazaar does *usage* ranking, but off-GOAT and centralized.

- **What:** Every paid tool and every buying agent gets an ERC-8004 identity. Each settled receipt,
  refund, dispute outcome, and bond slash feeds a **trustless, on-chain-anchored reputation score**.
  Agents discover and rank tools by **proven usage + outcome quality**, not marketing.
- **User story:** *As a buyer agent, I want to pick the highest-reputation tool for a capability so I
  don't waste budget on unreliable services.*
- **Requirements**
  - R1: Write outcome signals into the canonical ERC-8004 Reputation Registry on GOAT.
  - R2: `ReputationScorer` aggregates score = f(volume, success rate, dispute rate, slash history,
    tenure, unique payers), recomputed on a cadence; exposed via API + on-chain view.
  - R3: Reputation attaches to **identity**, portable across gateways; supply-side (tools) *and*
    demand-side (agents) scored.
  - R4: `/explorer` ranks tools by reputation and shows the receipts behind each score.
- **GOAT primitives:** ERC-8004 Identity + Reputation + Validation registries; `.goat` naming for
  legible handles; Bitcoin-anchored receipts as the credibly-neutral signal source.
- **Acceptance:** a leaderboard where each tool's score links to the on-chain receipts/slashes that
  produced it, and the buyer agent provably selects by score.

### 5.2 Feature — **Quality bonds & SLA insurance (charge-on-QUALITY)** *(gap #2)*

**Verdict:** `NOT_DONE_ON_GOAT`. ThoughtProof (GOAT grantee) does *buyer-side pre-action* reasoning
verification with no economic penalty — **complementary**, and reusable as our verifier oracle.
ClawTrust/Kite prove bonding/slashing exists elsewhere but not on GOAT and not as MCP-tool insurance.

- **What:** A paid tool stakes a **bond**. If it fails, times out, or returns provably bad output,
  the buyer is **auto-refunded from the bond** and the tool is **slashed**. This upgrades
  charge-on-success → **charge-on-quality**: an insurance layer for the agent tool economy.
- **User story:** *As a buyer agent, I want a refund when a paid tool underdelivers, without trusting
  the seller's goodwill.*
- **Requirements**
  - R1: `QualityBond` contract — stake, tiered bond sizes, lock while active, withdraw after
    cool-down, slash on adjudicated failure.
  - R2: **Verifier oracle** declares an output "provably bad" → triggers slash + refund. Pluggable;
    **ThoughtProof** or a swarm of verifier agents as the default adjudicator.
  - R3: Bond size + slash history are **discoverable trust signals** at payment time (feeds §5.1).
  - R4: Bonds denominated / settleable with **Bitcoin-grade finality** — the "insurance escrow backed
    by Bitcoin" narrative no Base/testnet competitor can claim.
- **GOAT primitives:** ERC-8004 Validation Registry (fills the "crypto-economic slashing" hook the
  spec names but leaves unbuilt); Bitcoin/BitVM2 settlement; ThoughtProof integration.
- **Acceptance:** a tool with a staked bond returns bad output → verifier flags it → on-chain slash +
  buyer refund in one flow, visible in the dashboard and on the explorer.

### 5.3 Feature — **Cascading payments + agent-hires-agent delegation** *(gap #3)*

**Verdict:** cascade core `NOT_DONE_ON_GOAT` (additive, not redundant). Generic delegation is
crowded off-GOAT (Kite, Nevermined, AP2), so we lead on the two pieces unbuilt anywhere: a **single
root deposit capping an entire recursive call tree** with on-chain over-budget rejection, and
**upward recursive revenue attribution**.

- **What:** (a) Multi-hop cascade: one deposit caps the whole call tree; the contract refuses any hop
  that would exceed budget; a configurable share of a child hop's earnings flows **up** to the
  parent's payee. (b) **Delegation framing:** an agent delegates a **capped sub-budget** to another
  ERC-8004-identified agent, which can sub-delegate — a verifiable, auditable agent supply-chain.
- **Requirements**
  - R1: `CascadeController` — budget tree, per-hop cap check, `BudgetExceeded` rejection, recursive
    attribution, close/refund unspent.
  - R2: `parentId` propagation via `_meta` → `X-TIAGOH-PARENT-ID`; graph reconstructs from receipts.
  - R3: Sub-budgets enforced at the contract level (via x402 **DELEGATE** settlement mode + ERC-4337
    session keys), so an agent cannot be drained past its allowance at any depth.
- **GOAT primitives:** x402 DELEGATE settlement (EIP-3009/Permit2 + TSS) as the enforcement point;
  ERC-8004 identity + `.goat` for the org-chart; ERC-4337 session keys for scoped sub-budgets.
- **Acceptance:** open(budget) → root hop → child hop with attribution up the tree → an over-budget
  hop rejected on-chain → close refunds the remainder; the whole tree renders as a graph.

### 5.4 Feature — **Escrow, dispute & atomic multi-hop refund** *(gap #4 — the world-first piece)*

**Verdict:** `NOT_DONE_ON_GOAT`. x402 is fire-and-forget; refund/escrow is explicitly a "future
spec" (Coinbase FAQ). Point-to-point escrow exists off-GOAT (x402r, AP2, Stripe MPP) — but **atomic
refund UP a cascade tree with revenue splits is unbuilt anywhere**. This is tiagoh's defensible core.

- **What:** (1) escrowed/conditional payment held until the buyer confirms usefulness; (2) if any
  **downstream** hop fails after a parent already paid, the cascade **unwinds atomically** and
  cleanly, including revenue splits; (3) a lightweight **dispute/arbitration** path.
- **Requirements**
  - R1: `EscrowVault` — conditional hold, release on success/confirmation, timeout refund.
  - R2: **Atomic cascade unwind** — a failing hop rolls back its parents' already-settled payments
    across the tree, respecting attribution; all-or-nothing per cascade policy.
  - R3: `DisputeArbiter` — dispute window, arbiter selection, ruling; outcomes feed reputation (§5.1)
    and can trigger bond slashing (§5.2).
- **GOAT primitives:** **BitVM2 fraud-proof / challenge-response** repurposed as the on-chain
  arbitration substrate (GOAT built it for operator honesty; we reuse it to adjudicate
  escrow-release / refund claims); **Bitcoin finality** as the release guarantee.
- **Acceptance:** a 3-hop cascade where hop 3 fails → hops 1–2 auto-refund atomically with splits
  reversed → dispute logged → reputations updated; every step on the explorer.

### 5.5 Feature — **Live tool auction & dynamic price discovery** *(gap #5 — the demo dazzler)*

**Verdict:** `NOT_DONE_ON_GOAT`, and **reverse auctions are whitespace across the entire x402
ecosystem** (highest novelty, 8/10). Price *comparison* (Bazaar) exists on Base; competitive
*bidding to serve a request* exists nowhere.

- **What:** For a capability request, multiple competing tools **bid** (price + quality) in a live
  reverse auction; the buyer picks best value; settlement clears through tiagoh's existing cascade +
  revenue-split rails. Optional: streaming/per-second pricing and demand-based surge.
- **User story:** *As a buyer agent, I want tools to compete for my request so I get the best
  price/quality instead of a fixed sticker price.*
- **Requirements**
  - R1: `ToolAuction` — open a request, collect signed bids, clear by a policy (lowest price /
    best reputation-weighted value), settle the winner via x402.
  - R2: Eligible bidders filtered by ERC-8004 reputation (§5.1) and bond status (§5.2).
  - R3: A visceral **live auction view** in the dashboard (bid-off animation → winner → settle).
- **GOAT primitives:** ERC-8004 registry/reputation to assemble + score bidders; `.goat` naming for
  bidder identity; x402 variable-price hook to wire the cleared price into the 402 response;
  cascade/receipts for winner settlement + multi-party payout.
- **Acceptance:** a request triggers ≥3 bids, clears to a winner on policy, settles on-chain, and the
  losing/winning bids are all recorded and shown live.

---

## 6. System architecture

```
┌─────────────┐   MCP tool call     ┌──────────────────────────┐  upstream MCP  ┌────────────────┐
│ MCP host    │ ──────────────────▶ │  tiagoh gateway          │ ─────────────▶ │ your MCP server │
│ (Claude…)   │ ◀── 402 + price ─── │  (tiagoh wrap)           │                │ (unchanged)     │
│  + tiagoh   │ ── pay (x402) ────▶ │  · per-tool pricing      │                └────────────────┘
│    connect  │ ◀── result + rcpt ─ │  · charge-on-success     │
└─────────────┘                     │  · bond + escrow + auction│
      │                             └───────────┬──────────────┘
      │ x402 (ERC-3009/Permit2)                 │ events
      ▼                                          ▼
┌──────────────────────┐          ┌────────────────────────┐      ┌────────────────────────────────┐
│ x402 facilitator     │          │ tiagoh dashboard       │      │ EVM contracts (Solidity)        │
│ (GOAT, Bitcoin-fin.) │          │ revenue · graph ·      │      │ ReceiptRegistry · RevenueSplit  │
│ verify + settle      │          │ auction · reputation · │      │ CascadeController · PaymentChannel│
└──────────────────────┘          │ dispute center         │      │ QualityBond · EscrowVault ·     │
                                   └────────────────────────┘      │ DisputeArbiter · ReputationScorer│
                                                                   │ ToolAuction · AgentRegistry     │
                                                                   │ + ERC-8004 (identity/rep/valid.) │
                                                                   │ + BitVM2 arbitration hook       │
                                                                   └────────────────────────────────┘
```

### Monorepo layout (TypeScript, pnpm workspaces)

| Path | What |
| --- | --- |
| `packages/core` | Shared types, config schema, receipt + payment-graph + bond/dispute/auction models |
| `packages/gateway` | Seller-side proxy: wrap, price, x402 flow, charge-on-success, bond/escrow/auction hooks |
| `packages/client` | Buyer-side paying `fetch`: budget guard, cascade parent propagation, stdio bridge, refund handling |
| `packages/agent` | Autonomous Claude buyer: prices, budgets, buys, reads reputation, disputes bad output |
| `packages/cli` | `tiagoh` CLI — `init` / `wrap` / `connect` |
| `contracts` | Solidity (Foundry): all contracts in §5, ERC-8004 integration, BitVM2 arbitration hook, tests |
| `servers/goat-defi-data` | Flagship paid MCP: GOAT/BTC market data, RWA prices, DeFi yields |
| `servers/portfolio-analyst` | Paid MCP that **buys** from the data server — the cascade in action |
| `apps/dashboard` | Next.js 15 + shadcn/ui: revenue, cascade graph, reputation leaderboard, live auction, dispute center |
| `examples/wrap-third-party` | Wrapping the official `server-everything` MCP as paid + insured |
| `tools/e2e` | Local end-to-end demo + mock facilitator (no chain needed) |

### Tech stack
TypeScript (Node 20, pnpm), Next.js 15 + shadcn/ui, `@modelcontextprotocol/sdk`, x402 (ERC-3009 /
Permit2), **Solidity + Foundry**, ERC-8004, ERC-4337 (session keys), GOAT Network testnet, Claude
Opus 4.8 for the autonomous buyer.

---

## 7. Contracts (GOAT testnet, Solidity)

| Contract | Purpose |
| --- | --- |
| `ReceiptRegistry` | Anchor settled receipts with cascade `parentId`; duplicate protection; events |
| `RevenueSplit` | PaymentSplitter for the payment token; pull-based fixed-weight splits |
| `CascadeController` | Budget-tree cap, per-hop rejection, recursive attribution, close/refund |
| `PaymentChannel` | Prepaid channels; signed vouchers; redeem/reclaim |
| `QualityBond` | Stake / tiered bond / lock / slash / bond-backed refund (§5.2) |
| `EscrowVault` | Conditional hold, release, timeout refund; atomic cascade unwind (§5.4) |
| `DisputeArbiter` | Dispute window + ruling; BitVM2 arbitration hook; feeds reputation/slash (§5.4) |
| `ReputationScorer` | Aggregate score over ERC-8004 signals + receipts + slashes (§5.1) |
| `ToolAuction` | Open request, collect bids, clear by policy, settle winner (§5.5) |
| `AgentRegistry` | ERC-8004 identity binding + capped spend delegation via ERC-4337 session keys (§5.3) |

Reuse GOAT's deployed **ERC-8004** registries (identity / reputation / validation) rather than
re-implementing storage.

---

## 8. Surfaces (dashboard app)

Sections (see `DESIGN.md` for the full layout):
- **Dashboard** — live revenue, receipts table (explorer links), cascade payment graph.
- **Explorer** — reputation leaderboard, top tools, cascade stats, unique paying agents, bond/slash feed.
- **Playground** — interactive cascade: open budget → hops → over-budget rejection → refund.
- **Auction** — live reverse-auction view (bids → clear → settle).
- **Dispute center** — open disputes, arbiter rulings, atomic refunds, bond slashes.

---

## 9. Success metrics

| Metric | Target (hackathon) |
| --- | --- |
| Contracts live on GOAT testnet | ≥ 6, each with a linked tx |
| Real x402 settlement (no mock) | verified end-to-end, ≥ 1 tx |
| Cascade proven on-chain | ≥ 1 root + ≥ 3 downstream hops, over-budget rejection tx |
| Quality bond slash + refund | ≥ 1 end-to-end tx |
| Atomic multi-hop refund | ≥ 1 cascade unwind tx |
| Auction cleared | ≥ 1 auction with ≥ 3 bids, settled |
| Reputation leaderboard | live, backed by real receipts |
| Autonomous buyer | buys ≥ 4 tools under budget, uses reputation, disputes ≥ 1 bad output |

---

## 10. Milestones (final round · Jul 13 → 26, 2026)

- **M1 (days 1–3): Core on GOAT/EVM.** Solidity ReceiptRegistry + RevenueSplit + CascadeController
  + PaymentChannel; gateway/client/CLI on x402-GOAT; dashboard build (see DESIGN.md). *Exit:* real
  x402 settlement + cascade on GOAT testnet.
- **M2 (days 4–6): Trust features v1.** `QualityBond` (stake/slash/refund) + `EscrowVault` + atomic
  cascade unwind; `ReputationScorer` + leaderboard. *Exit:* bond slash + atomic refund txs, live
  leaderboard.
- **M3 (days 7–9): Auction + disputes + agent.** `ToolAuction` live view; `DisputeArbiter` +
  BitVM2 hook; autonomous buyer reads reputation + disputes bad output; ThoughtProof integration.
  *Exit:* auction cleared tx, dispute→refund flow.
- **M4 (days 10–13): Polish, verify, submit.** Testing playbook, buidl page (every contract hash +
  sample tx), demo video, spec write-up, application form. *Exit:* submission.

---

## 11. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| GOAT testnet / facilitator instability | Bundle a mock facilitator for chain-free dev; keep real settlement behind a flag with linked txs. |
| BitVM2 arbitration too heavy for hackathon | Ship a pluggable `DisputeArbiter` interface; default to an off-chain verifier oracle (ThoughtProof / swarm) with an on-chain ruling record; document BitVM2 as the trust-minimized upgrade path. |
| "Provably bad output" is subjective | Scope verification to objective failures first (timeout, malformed, schema-mismatch, contradicts a signed source); reputation handles the fuzzy long tail. |
| Feature sprawl vs. time | Core + §5.2 + §5.4 are the defensible headline; §5.1 is connective; §5.5 is the demo. Ship in that priority order. |
| Overlap with ThoughtProof | Frame as complementary and integrate it as the verifier oracle — a grant-ecosystem tie-in, not a collision. |
| No paid Anthropic key | Ship a labeled offline-simulation buyer; one flag swaps in live Claude. |

---

## 12. Open questions

1. Payment token on GOAT testnet — USDC-style ERC-3009 vs a demo wrapper? (confirm what the GOAT
   facilitator settles).
2. BitVM2 arbitration: direct integration vs. interface + off-chain oracle for the hackathon window?
3. Reputation scoring formula weights — publish as part of the spec and make them governable later.
4. Auction clearing policy default — lowest price vs reputation-weighted best value.
5. Brand: keep `tiagoh` lowercase everywhere; finalize logo + socials.
