# tiagoh — Contracts

The Solidity contract layer for **tiagoh**, the insured settlement & trust layer for the
agent economy on **GOAT Network** (a Bitcoin L2, 100% EVM-compatible). These contracts wrap
paid MCP tools with on-chain receipts, budget-bounded cascading payments, quality bonds,
escrow with atomic multi-hop unwind, disputes, reputation, reverse auctions, and capped agent
delegation. See `../docs/PRD.md` (§5, §7) for the product context.

Built with **Foundry**, Solidity `^0.8.24`, OpenZeppelin v5, and the canonical
**ERC-8004** registries.

## Quick start

```bash
# 1. Fetch dependencies into lib/ (idempotent; lib/ is gitignored).
bash setup-deps.sh

# 2. Compile.
forge build

# 3. Run the test suite.
forge test

# 4. Dry-run the deployment (no chain needed; logs addresses).
forge script script/Deploy.s.sol
```

### Deploy to GOAT testnet

```bash
export OWNER=0xYourOwner
export PAYMENT_TOKEN=0xErc3009Stablecoin       # ERC-3009 token the GOAT facilitator settles
export ERC8004_REPUTATION=0xGoatReputationReg  # canonical ERC-8004 Reputation Registry on GOAT
export ERC8004_IDENTITY=0xGoatIdentityReg      # canonical ERC-8004 Identity Registry on GOAT

forge script script/Deploy.s.sol \
  --rpc-url "$GOAT_RPC" \
  --private-key "$DEPLOYER_PK" \
  --broadcast
```

Reuse GOAT's already-deployed ERC-8004 registries rather than redeploying identity/reputation
storage — tiagoh's `ReputationScorer` and `AgentRegistry` reference them by address.

## Contracts (`src/`)

| Contract | Purpose (PRD §) |
| --- | --- |
| `ReceiptRegistry` | Anchor settled x402 receipts with cascade `parentId`; dedupe; permissioned recorders; events (§5.0 C5) |
| `RevenueSplit` | Pull-based, fixed-weight PaymentSplitter for one ERC-20 payment token (§5.0 C6) |
| `CascadeController` | One root deposit caps the whole call tree; per-hop `BudgetExceeded` rejection; recursive upward attribution; close/refund (§5.3) |
| `PaymentChannel` | Prepaid channels; signed monotonic vouchers (ECDSA); redeem/close/reclaim after timeout (§5.0 C7) |
| `QualityBond` | Tiered seller bond; lock while active; arbiter `slash` → buyer refund; withdraw after cooldown (§5.2) |
| `EscrowVault` | Conditional hold; release/timeout-refund; **atomic `unwindCascade`** refunding a whole tree (§5.4) |
| `DisputeArbiter` | Dispute window + ruling; drives `QualityBond.slash` / `EscrowVault.refund`; pluggable `IDisputeArbiter`; BitVM2 upgrade path (§5.4) |
| `ReputationScorer` | Aggregate score = f(volume, successes, unique payers, disputes, slashes); references ERC-8004 Reputation Registry; `scoreOf` view (§5.1) |
| `ToolAuction` | Reverse auction: `openRequest` → signed `submitBid` → `clear` (lowest price / reputation-weighted) → settle hook (§5.5) |
| `AgentRegistry` | Bind operator ↔ ERC-8004 agent id; capped spend delegation (`delegate`/`spend`) with sub-delegation (§5.3) |

### Interfaces (`src/interfaces/`)

- `IERC3009` — `transferWithAuthorization` / `receiveWithAuthorization` (the x402 payment token is ERC-3009).
- `IReceiptRegistry`, `IReputationRegistry`, `IDisputeArbiter` — shared surfaces used across the suite.

## Tests (`test/`)

`forge test` runs 16 tests across 5 suites (all passing):

- `ReceiptRegistry.t.sol` — records, updates aggregates, dedupes, recorder gating.
- `CascadeController.t.sol` — upward attribution, **over-budget hop rejection**, close/refund.
- `PaymentChannel.t.sol` — signed-voucher redeem happy path, monotonicity, timeout reclaim, bad-signature revert.
- `QualityBond.t.sol` — stake, arbiter slash → buyer refund, cooldown withdrawal.
- `EscrowDispute.t.sol` — dispute ruled for buyer → escrow refund + bond slash; **atomic cascade unwind**.

`test/mocks/MockERC20.sol` is a mintable ERC-20 standing in for the x402 payment token.

## Notes & TODOs for production logic

These skeletons compile and express the intended interfaces; a few spots are deliberately
simplified and marked for hardening:

- `CascadeController` — attribution flows one level per hop (value propagates up hop-by-hop).
  Compounding multi-level attribution policies and `parentId` receipt anchoring are wired
  through the gateway + `ReceiptRegistry` off-chain (`TODO(prod)` in-file).
- `DisputeArbiter` — rulings are recorded by a permissioned juror set / off-chain verifier
  oracle today; the trust-minimized target is a **BitVM2 fraud-proof arbiter** (documented
  in-file). Swap in a BitVM2-backed `IDisputeArbiter` without touching QualityBond/EscrowVault.
- `ReputationScorer` weights are governable placeholders, to be published as part of the spec.
- Contracts are unaudited hackathon skeletons — not production-audited settlement logic.
