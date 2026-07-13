# tiagoh — Vision

> **The trust layer for the agent economy, settled on Bitcoin.**

---

## The one sentence

Machines are about to trade with machines at internet scale. They already have a way to *pay* —
x402. What they do not have is a way to *trust*: no recourse when a paid tool lies, no memory of who
is reliable, no way to price competitively, and no way to compose payments through a supply chain of
tools that each buy from other tools. **tiagoh is the layer that makes autonomous, machine‑to‑machine
commerce trustworthy — and it settles with Bitcoin finality on GOAT Network.**

---

## Why now

Three things became true at the same time:

1. **Agents can pay.** x402 turned HTTP 402 into a real rail; it has already processed tens of
   millions of agentic payments. Paying an autonomous agent per API/tool call is a solved problem.
2. **Agents have identity.** ERC‑8004 shipped to mainnet and now carries tens of thousands of agent
   identities. An agent can be *named* and *remembered*.
3. **The rails have no guarantees.** x402 is, by the protocol authors' own words, fire‑and‑forget:
   push payments are irreversible; refunds, escrow, and disputes are explicitly a "future spec."
   ERC‑8004 stores identity and raw reputation *signals* but leaves scoring, validation slashing, and
   dispute resolution out of scope, on purpose.

So the payment primitive and the identity primitive both exist — and the **entire trust layer
between them is open**. Whoever builds it well becomes the place agents go to transact safely.

## Why Bitcoin, why GOAT

A trust layer is only as good as the finality under it. A multi‑hop payment chain that has to unwind
atomically — refund three hops up a tree because a downstream tool failed — **cannot** be built on
probabilistic finality without ugly race conditions and trust assumptions.

GOAT Network is uniquely suited:
- **Bitcoin‑grade settlement + BitVM2 fraud proofs.** GOAT already built challenge‑response dispute
  machinery to keep its sequencer honest. tiagoh repurposes that same substrate to adjudicate
  *commercial* disputes — escrow release, refund claims — so arbitration inherits Bitcoin‑anchored
  enforcement rather than a trusted committee. "Insurance escrow backed by Bitcoin" is a claim no
  Base/testnet competitor can make.
- **100% EVM‑compatible.** We ship in Solidity and reuse the deployed ERC‑8004 registries, ERC‑4337
  session keys, and Permit2 — no bespoke VM tax.
- **Native agent economy.** GOAT AgentKit already ships x402 + ERC‑8004 + `.goat` naming + agent
  discovery. tiagoh is not fighting the platform; it is the missing floor above it.

## The gap we are filling (and it is real)

We researched every one of our features against GOAT specifically, its grant recipients, and the
broader x402 ecosystem. The finding was consistent: on GOAT, **none** of the following exists yet —

- **Reputation ranking of paid tools** from real receipts (the ERC‑8004 registry is deployed but is
  raw storage — the scoring layer is unbuilt).
- **Quality bonds / SLA insurance** — tools that stake, get slashed for bad output, and auto‑refund
  the buyer.
- **Cascading multi‑hop payments** with an on‑chain budget tree and **recursive revenue attribution**.
- **Escrow, disputes, and atomic multi‑hop refunds** — and the cascade‑unwind piece is unbuilt
  *anywhere*, not just on GOAT.
- **Competitive reverse auctions** where tools bid to serve a request — whitespace across the whole
  x402 ecosystem.

We do not need to be first in the world on every piece. We intend to be **first on GOAT on all of
them**, and world‑first on the one that only makes sense once payments compose into trees: the
atomic, insured cascade.

## The wedge → the moat → the platform

- **Wedge — monetize MCP.** `tiagoh wrap` turns any MCP server into a paid tool in one step. This is
  the on‑ramp: easy, valuable, and it seeds the network with real paid tools and real receipts.
- **Moat — compose and insure.** The moment tools buy from other tools, tiagoh's cascade, bonds,
  escrow, and atomic refunds become load‑bearing — and none of them can be copied without the
  multi‑hop receipt graph underneath. Competitors ship point‑to‑point vending machines; we ship an
  insured supply chain.
- **Platform — trust and discovery.** Reputation, auctions, and dispute history compound into the
  place agents *start*: "find me the best, cheapest, most‑reliable tool for X, and cover me if it
  fails." That is a marketplace with a memory and an insurance desk.

## What "good" looks like in 3 horizons

- **Now (hackathon):** the core ported to GOAT, plus insured cascades, reputation, disputes, and a
  live auction — every claim backed by a GOAT testnet transaction. A judge watches a bond get slashed
  and a broken cascade refund itself, in real time.
- **Next (post‑hackathon):** a hosted control plane — register a server, get a paid, insured,
  reputation‑ranked endpoint + dashboard in one step. `npx tiagoh` on npm. The wire conventions
  (priced discovery, cascade attribution, bond + reputation) published as a spec the ecosystem can
  adopt.
- **Later (the vision):** tiagoh as the **default trust and settlement layer for machine‑to‑machine
  commerce**. A protocol take‑rate on settled volume is the business model. An agent‑facing
  discovery API where agents shop by price, reputation, and insurance. Cross‑chain settlement, with
  Bitcoin as the neutral base of trust. Reputation and bonds become portable agent credit.

## Principles

1. **Build on the rails, don't rebuild them.** x402 for payment, ERC‑8004 for identity, GOAT for
   settlement. tiagoh is the trust logic in between.
2. **Enforcement by construction, not by trust.** Budgets, bonds, and refunds are enforced by
   contracts and Bitcoin finality — not by a gateway's promise.
3. **Every claim is a transaction.** If we say it works, there is an explorer link — no mock in the
   path we claim is real.
4. **Composability is the product.** The single feature no one else has is that payments form trees;
   every other feature is 10× stronger when it exploits that.
5. **Honest positioning.** We say "first on GOAT," not "first in the world," except where it is
   literally true (the atomic insured cascade). Credibility is part of the moat.
6. **Complement the ecosystem.** Reuse GOAT primitives and integrate fellow grantees (e.g.
   ThoughtProof as a verifier oracle) instead of competing with them.

## The bet

The winners of the agent economy will not be the ones who let agents *pay*. Everyone will have that.
The winners will be the ones agents *trust* — the layer that remembers who is reliable, guarantees
the work, prices it competitively, and makes it safe to string many tools together into one answer.
**tiagoh is that layer, and it is settling on Bitcoin.**
