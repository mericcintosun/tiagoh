# tiagoh — Security Model & Mainnet Runbook

This document is the security reference for the tiagoh contract suite. It records the trust
model, the roles, the invariants the tests enforce, the findings fixed during hardening, and the
gates that MUST be cleared before mainnet. It is written to be an auditor's starting point.

> Status: testnet-hardened, **not yet independently audited**. Do not move real user funds through
> these contracts on mainnet until the "Mainnet gates" below are all green.

---

## 1. What moves value

Only four contracts custody or move tokens. Everything else is bookkeeping.

| Contract | Custodies tokens? | Who can move them out |
| --- | --- | --- |
| `EscrowVault` | yes (held escrows) | payer (release), anyone after deadline (refund), an authorized **arbiter** (release/refund/unwind) |
| `QualityBond` | yes (staked bonds) | seller (withdraw after cooldown), an authorized **arbiter** (slash, capped to a disputed escrow) |
| `PaymentChannel` | yes (channel deposits) | recipient (redeem/close), sender (reclaim after expiry, or cooperativeClose with the recipient's signature) |
| `CascadeController` | yes (cascade budget) | the cascade opener only |
| `RevenueSplit` | yes (pull splitter) | any payee (pull of their fixed share) |

`ReceiptRegistry`, `ReputationScorer`, `ERC8004ReputationRegistry`, `FeedbackAllowlist`,
`AgentRegistry`, `SessionKeyDelegator`, `ToolAuction` hold **no** funds — they are receipts,
scores, allowances, and auction bookkeeping.

## 2. Roles & trust

- **owner** (per contract, `Ownable2Step`): sets configuration and assigns the roles below. The
  owner is **not** implicitly an arbiter/juror/reporter on any money-moving path (least
  privilege). On mainnet the owner MUST be a `TimelockController` fronted by a Safe multisig
  (see §6). A single EOA owner is a testnet-only convenience.
- **arbiter** (`EscrowVault.isArbiter`, `QualityBond.isArbiter`): the `DisputeArbiter` contract.
  Can refund escrows and slash bonds — but only through dispute logic that is harm-bound (§4).
- **juror** (`DisputeArbiter.isJuror`): rules on disputes. Trusted to judge honestly; the
  harm-binding caps the damage a careless/colluding juror can do to a single disputed escrow.
- **reporter** (`ReputationScorer.isReporter`), **recorder** (`ReceiptRegistry.isRecorder`): the
  gateway. Writes settlement signals / anchors receipts.
- **feedback writer** (`FeedbackAllowlist.allowed`): the gateway, when the ERC-8004 registry is
  deployed in gated mode.

## 3. Invariants (enforced by `forge test`, incl. fuzz + invariant runs)

- **Escrow solvency**: the vault always holds ≥ the sum of still-held escrow amounts.
  (`Invariant.t.sol::invariant_vaultIsSolvent`)
- **Cascade budget cap**: `spent ≤ budget` for every cascade, always.
  (`Invariant.t.sol::invariant_spentNeverExceedsBudget`, `Fuzz.t.sol::testFuzz_cascade_*`)
- **Session cap**: total spent through a session key never exceeds its cap.
  (`Fuzz.t.sol::testFuzz_sessionKey_neverExceedsCap`)
- **Channel bound**: a channel never pays out more than its deposit.
  (`Fuzz.t.sol::testFuzz_channel_payoutBoundedByDeposit`)
- **Slash bound**: a slash never exceeds the live bond, and routes exactly to the buyer.
  (`Fuzz.t.sol::testFuzz_bond_slashNeverExceedsBond`)

## 4. Findings fixed during hardening (adversarial review)

Four independent adversarial review passes (access-control, signatures/replay, economic/griefing,
state-machine) plus fuzz/invariant tests. Fixed:

| ID | Severity | Issue | Fix |
| --- | --- | --- | --- |
| C1 | Critical | Disputes bound *ownership*, not *harm*: with `escrowId=0` anyone could self-propose and (permissionless) `rule()` to slash any seller's whole bond to themselves | `openDispute` is buyer-only and **harm-bound**: a slash requires a real HELD escrow the buyer funded to this seller, capped to `min(liveBond, escrowAmount)`. See `_validateHarm`. |
| H1 | High | `owner()` was implicitly an arbiter on `QualityBond`/`EscrowVault` → a compromised owner could drain all bond/escrow TVL directly | Removed the owner shortcut from `onlyArbiter`, `release`, `refund`. Only explicitly-granted arbiters move funds. |
| H2 | High | `PaymentChannel.close()` was callable by either party → the sender could front-run the recipient's `redeem` and strip earned funds | `close()` is recipient-only; the sender's early exit is `cooperativeClose` (requires the recipient's signed final amount) or `reclaim` (after expiry). |
| H3 | High | `EscrowVault.unwindCascade` could be bricked by a poison-token escrow injected into a victim cascade; and `ToolAuction.clear` DoS'd by unbounded bid spam | Unwind is **best-effort per escrow** (a reverting token is skipped, not fatal) + ranged unwind; auction bids are **deduped one-slot-per-bidder** and can only be lowered. |
| M1 | Medium | Fee-on-transfer/rebasing tokens booked nominal amounts → vault/cascade insolvency | `EscrowVault.deposit` and `CascadeController.openCascade` book the **actual received** balance delta. |
| M2 | Medium | Session-key `revoke` didn't kill a signed-but-unsubmitted spend across a re-grant | Per-session **epoch** bumped on grant/revoke and bound into the EIP-712 spend digest. |
| M3 | Medium | `BitVM2Arbiter`: proposer stake coupled to recourse (a revert bricked the dispute); `challengeWindow` was retroactively resizable | Stake return **decoupled** from recourse; recourse is `try`-wrapped best-effort; `finalizeAt` **snapshotted** at propose time. |
| M4 | Medium | Signatures used `abi.encodePacked` + `personal_sign` (no chainId) | All three signing contracts use **EIP-712** typed data (domain binds chainId + contract). |
| L1 | Low | A bond slashed to zero could be hijacked by a new seller | `bond()` keyed on `seller`, not `amount`. |
| L2 | Low | `DisputeArbiter` lacked `ReentrancyGuard` | Added `nonReentrant` on `rule`. |

## 5. Residual / accepted risks (must be understood before mainnet)

- **`BitVM2Arbiter` is optimistic and only as safe as its verifier.** Its `propose`/`rule` model
  means an unchallenged proposal is authoritative. Until GOAT's **real bidirectional** BitVM2
  verifier is wired (`ConfigureArbiter.s.sol`) and proven, this contract is **NOT** granted
  `isArbiter` on `QualityBond`/`EscrowVault`. The permissioned `DisputeArbiter` is the mainnet
  arbiter. The deploy scripts deliberately do not authorize BitVM2Arbiter.
- **Frivolous-dispute resistance rests on the juror + harm cap.** Harm-binding caps the blast
  radius to a single disputed escrow, but a malicious/colluding juror can still rule wrongly
  within that cap. Mitigate by running the juror as a multisig and moving to the verifier-backed
  arbiter over time.
- **On-chain ERC-8004 feedback is Sybil-able by spec** when deployed permissionless. Deploy with
  `FeedbackAllowlist` (gated mode) so only the gateway writes, or implement a receipt-gated
  `IFeedbackAuthorizer`. The app's trust score (`ReputationScorer`) is reporter-gated regardless.
- **Non-standard tokens.** Fee-on-transfer is handled (balance-delta), but exotic tokens
  (rebasing-down mid-hold, callback-on-transfer) are out of scope — use a vetted stablecoin
  (USDC-style, ERC-3009) as the payment token. Consider an on-chain allowlist if third parties
  can choose the token.
- **Auction settlement is off-chain.** `ToolAuction` clears a winner but a zero-price/no-bond
  Sybil can win a `LOWEST_PRICE` auction and under-deliver; settlement/reputation handles that
  off-chain. Add a bid bond if on-chain skin-in-the-game is required.

## 6. Mainnet gates (all must be green before real funds)

1. **Ownership → Timelock + multisig.** `DeployTimelock.s.sol` then `TransferOwnership.s.sol`
   (GOVERNANCE = the timelock); governance calls `acceptOwnership()` on each contract. No EOA
   owner in production.
2. **Real facilitator.** Set `facilitatorUrl` (config) so `createFacilitatorVerify` +
   `createFacilitatorSettle` (in `@tiagoh/goat`) are live; the gateway then verifies payment
   before running any tool. No mock settle in production.
3. **Real BitVM2 verifier (only if using BitVM2Arbiter).** `ConfigureArbiter.s.sol` with a
   non-stub `BITVM2_VERIFIER_ADDRESS` and a meaningful `PROPOSAL_BOND`, and only then grant it
   `isArbiter`. Otherwise use `DisputeArbiter`.
4. **ERC-8004 gated.** Deploy `ERC8004ReputationRegistry` with a `FeedbackAllowlist` authorizer;
   allowlist only the gateway.
5. **Static analysis clean.** `slither` (CI `slither` job) shows no high-severity findings.
6. **Independent audit.** A third-party audit of the value-moving contracts (EscrowVault,
   QualityBond, PaymentChannel, CascadeController, DisputeArbiter, RevenueSplit) is completed and
   findings resolved.
7. **Payment token vetted.** The ERC-3009 payment token is a known, non-exotic stablecoin.

## 7. Reporting

Found something? Do not open a public issue for an exploitable bug. Email the maintainer
(see the repo profile) with a private disclosure and a reproduction.
