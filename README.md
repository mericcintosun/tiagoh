<div align="center">

# tiagoh

**Get paid per call for your MCP tools. AI agents pay in x402, settled on GOAT Network.**

[▶ Watch the 3 min demo](https://youtu.be/TA4zJ36k0PU) · [Live metrics](https://tiagoh.vercel.app/metrics) · [Live demo](https://tiagoh.vercel.app) · [MCP endpoint](https://tiagoh.vercel.app/api/mcp) · [Deployments](docs/DEPLOYMENTS.md) · [x402 spec](docs/x402-mcp-spec.md)

Live on GOAT Network mainnet · GOAT Network AI Builder 2026

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
not marketing. Everything settles on GOAT Network, a Bitcoin L2.

## What is live right now

- **17 Solidity contracts** (Foundry), covering settlement, escrow, disputes, bonds, reputation,
  auctions, cascades, payment channels, an ERC-4337 session-key allowance ledger, a BitVM2
  optimistic arbiter and an ERC-8004 reputation registry. **209 of 209 contract tests passing**
  (unit, fuzz, invariant) plus **105 TypeScript tests**. See [SECURITY.md](docs/SECURITY.md) for
  the threat model and the two hardening passes.
- **End to end x402 flow**: the gateway answers 402 with a single-use challenge, the client pays
  under budget and pre-signs the receipt, the tool runs, only a successful call is billed, and the
  settled receipt carries **both parties' signatures**. Replaying a spent challenge neither
  re-executes the tool nor bills again. Run it with `pnpm --filter @tiagoh/e2e demo`.
- **Autonomous buyer** that reads bond-capped on-chain reputation, pays per call, verifies each
  output, and disputes the bad ones against a co-signed receipt. Run it with
  `pnpm --filter @tiagoh/e2e agent`.
- **Live dashboard** at [tiagoh.vercel.app](https://tiagoh.vercel.app) that reads the deployed
  contracts client side, no backend.
- **Hosted MCP endpoint** at [/api/mcp](https://tiagoh.vercel.app/api/mcp) — seven tools, every one
  reading a live source at call time. Two are free; the rest cost $0.02 and settle per call. Any MCP
  host can call it over streamable-HTTP, and payment travels either in `X-PAYMENT` or as tool
  arguments, so hosts that cannot set custom headers can still pay.
- **Anyone can pay, with no gas and no account.** GOAT's bridged **USDC.e** is a real Circle
  FiatTokenV2, so tiagoh runs the canonical x402 v2 `exact` scheme natively: the buyer signs an
  ERC-3009 authorization, the gateway verifies it against the chain before doing any work, and
  whoever relays pays the (near-zero) gas. **A wallet holding nothing but USDC.e and zero BTC can
  buy tool calls.** No facilitator, no merchant account, no bridging gas first.
- **Payment, protocol fee and evidence in one transaction.**
  [`X402Settler`](contracts/src/X402Settler.sol) (`0x630b7C9D…`) pulls the authorization, takes
  the fee, pays the seller and anchors the **co-signed** receipt atomically. If either signature
  is bad the whole thing reverts — so a settled payment always leaves behind evidence a buyer can
  dispute against. Fee ships at 0%, hard-capped at 5% in the contract.
- **Real per-call settlement on mainnet**, bound to real bridged **USDC.e** (`0x3022b87a…`), with
  every transaction tagged with an ERC-8021 builder code so it is filterable on chain by anyone.
  Watch the counter at [tiagoh.vercel.app/metrics](https://tiagoh.vercel.app/metrics).

> The addresses in [contracts/deployments/goat-mainnet.json](contracts/deployments/goat-mainnet.json)
> are the **current USDC.e-bound deployment** (GOAT mainnet, chainId 2345, deployed 2026-08-08 from
> this tree). Earlier DemoToken suites are recorded there under `legacySuites` and are excluded from
> headline metrics as internal traffic.

## Features

| Feature | What it does |
| --- | --- |
| Wrap | `tiagoh wrap` puts an x402 paywall in front of any MCP server, unchanged |
| Cascade | multi hop payments with one budget cap, capped sub budgets, and recursive revenue attribution |
| Quality bonds | a tool stakes a bond, slashed to compensate the buyer on bad output |
| Escrow and dispute | conditional payment, atomic multi hop refund, harm bound rulings |
| Co signed receipts | every settled call signed by buyer **and** seller, so neither can forge or suppress the record |
| Reputation | on chain score built from real receipts, capped by the tool's live bond |
| Reverse auction | tools bid to serve a request, backed by a bid bond and a delivery obligation |
| Delegation | an agent grants another a capped, sub delegatable spend budget |

## Run the demos

```bash
pnpm install && pnpm -r --filter "./packages/**" build

# End to end x402 flow: per call payment, charge on success, replay protection,
# a 3 hop cascade, budget rejection, co signed receipts
pnpm --filter @tiagoh/e2e demo

# Same flow, anchoring real receipts to ReceiptRegistry on GOAT
TIAGOH_ONCHAIN=1 PRIVATE_KEY=0x… pnpm --filter @tiagoh/e2e demo

# Autonomous buyer: discover, read reputation, pay, verify, dispute bad output
pnpm --filter @tiagoh/e2e agent

# Two processes, real money: a buyer that holds no gas pays a gateway it does not run.
# The gateway process cannot obtain the buyer's key — that separation is the point.
#   terminal A (seller):
TIAGOH_SELLER_KEY=0x… PRIVATE_KEY=0x… X402_SETTLER_ADDRESS=0x630b7C9D… \
  pnpm --filter @tiagoh/e2e serve
#   terminal B (buyer — this wallet needs USDC.e and NO BTC):
BUYER_PRIVATE_KEY=0x… pnpm --filter @tiagoh/e2e pay -- --url http://localhost:4402

# Everything: TypeScript unit tests + contracts (unit + fuzz + invariant)
pnpm test                                      # 105/105
pnpm contracts:setup && pnpm contracts:test    # 209/209
```

Full reviewer path: [docs/testing-playbook.md](docs/testing-playbook.md).

## Architecture

```
MCP host or agent  ──call──▶  tiagoh gateway  ──402, pay, run──▶  your MCP server
    (pays x402)               (charge on success)                 (unchanged)
                                     │
                                     ▼
                         GOAT Network mainnet contracts
   ReceiptRegistry · CascadeController · QualityBond · EscrowVault · DisputeArbiter
   DisputeHarmBinding · ReputationScorer · ToolAuction · AgentRegistry · RevenueSplit
   PaymentChannel · SessionKeyDelegator · BitVM2Arbiter · ERC8004ReputationRegistry
```

| Path | What |
| --- | --- |
| `packages/gateway` | seller side: wrap, price, run the x402 flow, charge on success |
| `packages/client` | buyer side: paying fetch, budget guard, stdio bridge for MCP hosts |
| `packages/agent` | autonomous buyer: reads reputation, verifies output, disputes |
| `packages/goat` | GOAT foundation: x402 and ERC-8004 (AgentKit), viem clients, on chain settle |
| `packages/cli` | `tiagoh` CLI: init, wrap, connect, call |
| `contracts` | Solidity (Foundry): the 17 contracts, tests, deploy scripts |
| `apps/dashboard` | Next.js dashboard, reads chain client side |
| `tools/e2e` | runnable end to end demo |

## Docs

- [PRD.md](docs/PRD.md), [VISION.md](docs/VISION.md), [DESIGN.md](docs/DESIGN.md)
- [DEPLOYMENTS.md](docs/DEPLOYMENTS.md): contract addresses and exercised transactions
- [x402-mcp-spec.md](docs/x402-mcp-spec.md): the wire conventions
- [testing-playbook.md](docs/testing-playbook.md): how to verify it works

## Honest scope

- **The contracts are hardened and statically analysed, but not independently audited.** Slither
  reports zero high-severity findings and Aderyn zero findings in the settler;
  [SECURITY.md](docs/SECURITY.md) lists every finding, the residual risks, and the mainnet gates.
  Guarded value caps stay on until a real audit — `X402Settler` is capped at $5 per settlement.
- **The owner is still an EOA.** Move it to a timelock + multisig before real value flows; the
  caps are what bound the exposure until then.
- **Traffic so far is our own, and we label it as such.** The counter on `/metrics` publishes the
  wallets it excludes. A loop we run proves the loop works; it does not prove demand.
- **Judging output quality is still the open problem.** Bonds and disputes give a buyer real
  recourse, but only once something decides an output was bad. The shipped verifier catches
  objective failures (empty, errored, missing fields); it does not catch plausible-but-fabricated
  data, and a fraud proof cannot decide that either — BitVM2 proves deterministic execution, not
  truth about the world. The direction that actually shrinks the problem is making tools attest to
  their inputs and sources, so a dispute becomes a signature check rather than a judgement call.
  See [SECURITY.md §5](docs/SECURITY.md).
- **The payment token is real bridged USDC.e** (`0x3022b87ac063DE95b1570F46f5e470F8B53112D8`,
  Stargate, 6 decimals). The earlier labeled `DemoToken` deployments are retired and recorded as
  `legacySuites`, excluded from headline metrics.

## Tech

TypeScript, Node 20, pnpm workspaces. Next.js 15 and shadcn/ui. `@modelcontextprotocol/sdk`. x402
with ERC-3009 (canonical `exact` scheme). Solidity with Foundry. ERC-8004. GOAT Network mainnet. Claude Opus 4.8 for the buyer.
