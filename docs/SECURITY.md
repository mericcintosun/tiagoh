# tiagoh — Security Model & Mainnet Runbook

This document is the security reference for the tiagoh contract suite. It records the trust
model, the roles, the invariants the tests enforce, the findings fixed during hardening, and the
gates that MUST be cleared before mainnet. It is written to be an auditor's starting point.

> Status: hardened, statically analysed and fully tested (**209 Foundry tests** — unit, fuzz,
> invariant; **120 TypeScript tests**), **not yet independently audited**. Slither reports zero
> high-severity findings across the suite and Aderyn none in `X402Settler` (§4d). The addresses in
> `contracts/deployments/goat-mainnet.json` match this document. Guarded value caps stay on and
> the "Mainnet gates" below are not all green — most notably the timelock's proposer is still a
> single EOA — so do not move funds you cannot afford to lose through these contracts.

---

## 1. What moves value

| Contract | Custodies tokens? | Who can move them out |
| --- | --- | --- |
| `EscrowVault` | yes (held escrows) | payer (`release`), **payee after the dispute window** (`claim`), an authorized **arbiter** (`refund`/`unwindCascade`), anyone once an escrow is stale (`resolveStale`, pays the payee) |
| `QualityBond` | yes (staked bonds) | seller (`withdraw`, after both the unbonding and post-slash cooldowns), an authorized **arbiter** (`slash`, capped to proven harm) |
| `PaymentChannel` | yes (channel deposits) | recipient (`redeem`/`close`), sender (`reclaim` after expiry, or `cooperativeClose` with the recipient's signature) |
| `CascadeController` | yes (cascade budget) | holders of a cascade **allowance** (`payHop`); refunds always go to the opener |
| `DisputeArbiter` | yes (dispute stakes) | settled to the winning party on a ruling, or returned to the buyer on expiry |
| `ToolAuction` | yes (bid bonds) | the bidder (`refundBidBond`), or the buyer if the winner no-shows (`claimNoShow`) |
| `RevenueSplit` | yes (pull splitter) | any payee (pull of their fixed share) |

`ReceiptRegistry`, `ReputationScorer`, `ERC8004ReputationRegistry`, `FeedbackAllowlist`,
`AgentRegistry`, `SessionKeyDelegator` hold **no** funds.

### 1.1 Settlement direction (read this before reasoning about escrows)

An escrow's `deadline` is the **buyer's dispute window**, not a refund trigger:

- before it, the buyer may `release` early;
- after it with no dispute open, the **seller** may `claim` — silence settles in favour of the
  party that already delivered;
- a refund happens only through adjudication, and only an arbiter can order one.

The previous design let anyone refund the payer once the deadline passed, which meant a buyer
could take the output, stay silent, and reclaim the money for free. A timeout must never default
in favour of the party that already received value.

## 2. Roles & trust

- **owner** (per contract, `Ownable2Step`): sets configuration and assigns the roles below. The
  owner is **not** an arbiter, juror, recorder or reporter on any path, implicitly or otherwise —
  this is now true of every contract in the suite. (It previously held only for `QualityBond` and
  `EscrowVault`; `DisputeArbiter`, `ReceiptRegistry` and `ReputationScorer` still carried a
  `|| msg.sender == owner()` shortcut, contradicting this section.) `ToolAuction` no longer lets
  the owner clear or settle someone else's request either, because deciding *when* an auction
  closes decides which bids are in it. On mainnet the owner MUST be a `TimelockController`
  fronted by a Safe multisig (§6).
- **arbiter** (`EscrowVault.isArbiter`, `QualityBond.isArbiter`): the `DisputeArbiter` contract.
  Can refund escrows, freeze them, and slash bonds — but only through dispute logic that is
  harm-bound (§4).
- **juror** (`DisputeArbiter.isJuror`): rules on disputes, and must do so inside `rulingWindow`.
  Trusted to judge honestly; harm-binding caps the damage a careless or colluding juror can do to
  a single disputed call.
- **reporter** (`ReputationScorer.isReporter`), **recorder** (`ReceiptRegistry.isRecorder`): the
  gateway. Writes settlement signals / anchors telemetry receipts. Neither can move value.
- **feedback writer** (`FeedbackAllowlist.allowed`): the gateway, when the ERC-8004 registry is
  deployed in gated mode.

### 2.1 Receipts: telemetry vs evidence

`ReceiptRegistry` stores two attestation levels and the distinction is load-bearing:

- **`RECORDER`** — written by an authorized gateway. Telemetry. The gateway is the seller's own
  infrastructure, so a unilateral receipt proves nothing and *cannot* back a dispute.
- **`COSIGNED`** — anchored permissionlessly by anyone holding EIP-712 signatures from **both**
  the payer and the payee (via `SignatureChecker`, so ERC-1271 smart accounts work too). Neither
  side can forge it, and neither side can suppress it. This is the only kind `DisputeArbiter`
  accepts as proof of harm.

Co-signing removes the gateway's position as sole writer of the record its own reputation is
built from — without needing a consensus mechanism to do it.

## 3. Invariants (enforced by `forge test`, incl. fuzz + invariant runs)

- **Escrow solvency**: the vault always holds ≥ the sum of still-held escrow amounts, under any
  interleaving of deposit / release / claim / refund / freeze / resolveStale.
  (`Invariant.t.sol::invariant_vaultIsSolvent`)
- **Cascade budget cap**: `spent ≤ budget` for every cascade, always.
  (`Invariant.t.sol::invariant_spentNeverExceedsBudget`, `Fuzz.t.sol::testFuzz_cascade_*`)
- **Cascade collateralization**: the controller always holds ≥ the unspent budget of every open
  cascade, so `close` can always refund. (`invariant_controllerCoversOpenCascades`)
- **Session cap**: total spent through a session key never exceeds its cap.
  (`Fuzz.t.sol::testFuzz_sessionKey_neverExceedsCap`)
- **Channel bound**: a channel never pays out more than its deposit.
  (`Fuzz.t.sol::testFuzz_channel_payoutBoundedByDeposit`)
- **Slash bound**: a slash never exceeds the live bond and routes exactly to the buyer.
  (`Fuzz.t.sol::testFuzz_bond_slashNeverExceedsBond`)
- **Harm bound**: a slash never exceeds `min(provenHarm, liveBond)`, and each piece of evidence
  backs at most one dispute. (`EscrowDispute.t.sol`)

## 4. Findings fixed during hardening

### 4a. First pass — adversarial review (access control, signatures/replay, economics, state machine)

| ID | Severity | Issue | Fix |
| --- | --- | --- | --- |
| C1 | Critical | Disputes bound *ownership*, not *harm*: with `escrowId=0` anyone could self-propose and slash any seller's whole bond to themselves | `openDispute` is buyer-only and harm-bound, capped to `min(provenHarm, liveBond)` |
| H1 | High | `owner()` was implicitly an arbiter on `QualityBond`/`EscrowVault` | Removed the owner shortcut from those money-moving paths |
| H2 | High | `PaymentChannel.close()` was callable by either party → the sender could front-run `redeem` | `close()` is recipient-only; the sender exits via `cooperativeClose` or `reclaim` |
| H3 | High | `unwindCascade` brickable by a poison-token escrow; `ToolAuction.clear` DoS'd by bid spam | Best-effort per-escrow unwind + ranged unwind; bids deduped one slot per bidder |
| M1 | Medium | Fee-on-transfer/rebasing tokens booked nominal amounts → insolvency | Deposits book the **actual received** balance delta |
| M2 | Medium | Session-key `revoke` didn't kill a signed-but-unsubmitted spend across a re-grant | Per-session **epoch** bound into the EIP-712 spend digest |
| M3 | Medium | `BitVM2Arbiter`: proposer stake coupled to recourse; challenge window retroactively resizable | Stake return decoupled; `finalizeAt` snapshotted at propose time |
| M4 | Medium | Signatures used `abi.encodePacked` + `personal_sign` (no chainId) | All signing contracts use **EIP-712** typed data |
| L1 | Low | A bond slashed to zero could be hijacked by a new seller | `bond()` keyed on `seller`, not `amount` |
| L2 | Low | `DisputeArbiter` lacked `ReentrancyGuard` | Added `nonReentrant` on `rule` |

### 4b. Second pass — design review (reachability, defaults, economics, units)

The first pass hardened each contract in isolation. This pass asked whether the *system* did what
it claimed, and several things did not.

| ID | Severity | Issue | Fix |
| --- | --- | --- | --- |
| D1 | Critical | **Recourse was unreachable.** The shipped flow settles instantly, so no escrow exists — but a slash required a held escrow. Every dispute the product could actually open was a no-op: no refund, no slash | Harm can now be proven by a **co-signed receipt** as well as an escrow, so the instant-settle path has real recourse out of the seller's bond (`DisputeHarmBinding`) |
| D2 | Critical | **Escrow timeout paid the wrong party.** Anyone could refund the payer after the deadline, so a buyer could take the output, wait, and get the money back for free | `deadline` is the dispute window; the **payee** claims after it, refunds are arbiter-only (`EscrowVault.claim` / `refund`) |
| D3 | Critical | **Payment replay → unlimited free work.** Charge-on-success runs the tool *before* settlement can reject a reused authorization, and the gateway kept no nonce state. Verification was optional and off by default | Single-use challenge nonces + an idempotency store; the gateway refuses to construct without `verifyPayment` unless `allowUnverifiedPayments` is set explicitly (`packages/gateway`) |
| D4 | High | **The gateway was the sole writer of its own record.** Receipts and reputation were written by the seller's infrastructure and treated as fact | Receipts carry both parties' EIP-712 signatures and anchor permissionlessly; only co-signed receipts back disputes (`ReceiptRegistry`) |
| D5 | High | **Cascade funds could be locked forever.** Only the opener could `close`, and there was no deadline | Cascades expire; after expiry **anyone** may close, and the refund always goes to the opener |
| D6 | High | **`payHop` was opener-only**, so "an agent hires an agent" could not happen on-chain — yet letting any payee spend the pool would let one sub-tool drain it | Per-participant **allowances**: `delegate` hands a bounded, sub-delegatable slice down the tree; a hop spends only from the caller's own slice |
| D7 | High | **Reputation was free to farm.** Gas is ~free on GOAT, so wash trading and fresh-address Sybils cost almost nothing, and whitewashing (abandon a slashed identity) was strictly *profitable* because scores floor at zero | Scores are **capped by the live bond**: `min(raw, liveBond / bondScoreDivisor)`. An unbonded identity scores zero however much it fabricates; a slash lowers the cap immediately; whitewashing costs a full new bond |
| D8 | High | **Anyone could inject escrows into a victim's `cascadeId`**, bloating the arbiter's unwind — and the unwind refunded the attacker's own deposit, making the grief free | A cascade tag is owned by its registrar; only the registrar or an address already paid inside the tree may join it |
| D9 | Medium | **Disputes were free to open**, so griefing cost nothing, and a silent juror could freeze an escrow indefinitely | Disputers post a stake (forfeited to the seller if they lose); jurors must rule inside `rulingWindow`, after which anyone may `expire` the dispute, returning the stake and unfreezing the escrow |
| D10 | Medium | **A receipt could be re-disputed** until a seller's whole bond was drained; stale calls could be dragged up against a current bond | One dispute per receipt and per escrow; receipt disputes must open within `disputeWindow` of anchoring |
| D11 | Medium | **Zero-price no-show Sybils won every `LOWEST_PRICE` auction** with nothing at stake | Bidders post a **bid bond**; the winner's is locked until delivery is confirmed and forfeited to the buyer on a no-show |
| D12 | Medium | **A slashed seller could withdraw the remainder immediately** and re-register clean | Post-slash cooldown on withdrawal; `totalSlashed` / `slashCount` are permanent per address and survive unbonding; `topUp` lets an honest seller restore standing instead |
| D13 | Medium | **Money was floats end to end**, and two paths disagreed: settlement wrote cents (`usd*100`) while `ReputationScorer` divided by `1e6` (token units) — four orders of magnitude apart. The dashboard also rendered on-chain amounts as cents | One integer type in the token's minor units across config, wire, receipts and chain (`@tiagoh/core/money`); floats survive only at the display boundary |
| D14 | Medium | **Two hand-maintained copies of the harm check** (`DisputeArbiter` and `BitVM2Arbiter`) — the classic drift-into-vulnerability shape | Extracted to a single `DisputeHarmBinding` base that both inherit |
| D15 | Low | The owner was implicitly a juror / recorder / reporter, contradicting §2 of this document | Removed everywhere, including `ToolAuction`'s shortcut on `clear`/`settle` |
| D16 | Low | The default chain was Testnet3 while every address was mainnet, so "live" reads silently reported unavailable | Default chain is mainnet; testnet has its own env vars |

### 4c. Third pass — the x402 settlement path (`X402Settler`)

Adding a real external-payment path meant a new contract that touches money, and two bugs in the
existing signing layer that had been invisible because nothing exercised them.

| ID | Severity | Issue | Fix |
| --- | --- | --- | --- |
| S1 | Critical | **`settleBare` was going to be permissionless.** A standard x402 client produces a payment authorization but no tiagoh receipt signatures, so nothing binds `payee`. Anyone watching the mempool could have re-submitted a pending authorization naming themselves as payee and taken the payment | `settleBare` is `onlyOperator`. The signed path (`settle`) stays permissionless precisely *because* the signatures cover every field, so no allowlist is needed there |
| S2 | High | **Cascade hops could never be co-signed.** `createChallengeReceiptSigner` hardcoded `parentId` to zero while the gateway counter-signed the real parent, so the two parties signed different structs and `anchorReceipt` rejected every hop. Co-signing failure is deliberately non-fatal, so this failed *silently*: multi-hop payments — the feature the product is built around — produced receipts that could never back a dispute | `parentId` is carried in the 402 challenge and signed by both sides (`gateway.toChallenge`, `receipts.ts`); regression tests assert a hop's buyer signature verifies against the gateway's struct |
| S3 | High | **A chain-id mismatch produced a valid signature for the wrong chain.** The chain id is part of the EIP-712 domain, so a stale `GOAT_CHAIN_ID=48816` against a mainnet RPC yields a well-formed authorization the token rejects as "invalid signature" — pointing the reader at the signer instead of at their config. This is how it was actually found | `resolveTokenDomain` reads `eth_chainId` and refuses to sign on a mismatch, with an error that names both values |
| S4 | Medium | **Donated tokens were permanently stranded.** Settlement books the balance *delta*, and the settler is a pure conduit with no other way to move a balance — so anything sent here by mistake was lost | Permissionless `sweep()` pushes any stray balance to `treasury`. Permissionless because the destination is fixed, so it adds no privilege that `setTreasury` does not already imply, and recovery does not depend on the owner key |
| S5 | Medium | An owner could have set an arbitrary protocol fee | `MAX_FEE_BPS = 500` (5%), enforced in the setter; `feeBps` ships at 0 |
| S6 | Low | Wallets disagree on whether `v` is 27/28 or 0/1; the token only accepts the former, so valid signatures would be rejected depending on which library produced them | `_splitSignature` normalizes `v` and rejects anything that is still not 27/28 |

**Why atomicity matters here.** `settle` anchors the co-signed receipt in the *same transaction*
that moves the money. If either signature is bad, `anchorReceipt` reverts and the payment reverts
with it. The cheapest, most convenient path is therefore also the one that produces dispute-grade
evidence — a settled payment cannot exist without it. The previous two-transaction shape could
leave a paid call whose receipt never anchored.

**Replay protection moved into the token.** The gateway's challenge nonce is reused verbatim as
the ERC-3009 authorization nonce, so `authorizationState` is the guard. That is strictly stronger
than the in-memory nonce set, which only ever protected a single process (§5) — double-charging is
now impossible across a cluster, though tool-execution idempotency is still per-instance.

**Residual risks specific to this path:**

- **Simulation is not a guarantee.** `verify` proves the authorization is settleable *now*; the
  buyer could move funds before settlement lands. Charge-on-success means the tool has already run
  at that point, so the seller eats one call. Bounded and logged, not silent.
- **The fee can change between quote and settlement.** The buyer is unaffected (they signed a
  fixed `value`), but the seller's share could shift. Bounded by `MAX_FEE_BPS`, owner-only, and
  observable once the owner is a timelock.
- **A settler-written receipt (`settleBare`) is `RECORDER`-level**, so harm-binding still rejects
  it. It is nonetheless stronger than gateway telemetry: it is emitted in the same transaction as
  a real token transfer, so it cannot describe a payment that did not happen.

### 4d. Static analysis + guarded launch

Free tooling only — this is **not** a substitute for an independent audit, and the guarded caps
stay on. Last run 2026-08-09 against the full suite:

| Tool | Result |
| --- | --- |
| **Slither** (`--config-file contracts/slither.config.json`) | **0 high**, 19 medium, 36 low, 6 informational. The one high it originally reported (`reentrancy-balance` in `X402Settler._pullAndSplit`) was investigated and is unreachable — both entry points are `nonReentrant`, the function is `private`, every other state-changing function is `onlyOwner`, and `token` is immutable. Suppressed at the line with that justification. Investigating it is what surfaced S4. |
| **Aderyn** 0.1.9 | 4 high, all pre-existing and all false positives: `transferFrom` with a "arbitrary" `from` that is literally `msg.sender` (`DisputeArbiter:108`); a storage struct passed to a `memory` parameter for a read-only score computation; deliberately zero-initialized counters; a return value whose only consumer is the `RecourseExecuted` event emitted inside the same function. **Zero findings in `X402Settler`.** |
| **Foundry** | 209 tests: unit, fuzz (`fee + net == gross` exact at every fee and amount), invariant (2048 calls/run, 0 reverts, with an `afterInvariant` guard so a run that settled nothing fails rather than passing vacuously) |
| **Coverage** (`forge coverage --ir-minimum`) | `X402Settler`: **100% lines, 100% functions**, 98.8% statements, 94.4% branches |

Remaining Slither mediums in the new contract: one `incorrect-equality` for `received == 0`,
which is a deliberate "nothing arrived" guard rather than a balance comparison driving logic.

- **Slither** runs in CI (`.github/workflows/ci.yml`, `slither` job, fail-on high).
- **Guarded launch (no-audit-budget mitigation):** the value at risk per position is capped so a
  pre-audit mainnet bounds any single loss:
  - `X402Settler.maxSettlement` (owner-settable, 0 = unlimited) — $5 on the live deployment
  - `X402Settler.MAX_FEE_BPS` (compile-time constant, 5%) — the owner cannot exceed it
  - `EscrowVault.maxEscrow` (owner-settable, 0 = unlimited)
  - `CascadeController.maxBudget` (owner-settable, 0 = unlimited)
  - `PaymentChannel.depositCap` (immutable, set at deploy)
  - `DisputeArbiter.disputeStake`, `ToolAuction.bidBond` (owner-settable)

  Set them with `SetLaunchCaps.s.sol`. This is a risk *reducer*, not a substitute for an audit.

## 5. Residual / accepted risks

- **Verifying output quality is an oracle problem, and it is not solved here.** The bond/dispute
  machinery is only as good as the judgement that triggers it. Today that judgement is a
  permissioned juror (optionally an off-chain verifier such as ThoughtProof), and the default
  heuristic verifier only catches *objective* failures — empty output, an explicit error, a
  missing required field. **A tool returning plausible-but-fabricated data is not detected.**
  Three honest ways forward, in increasing cost:
  1. **Make disputes objective.** Require tools to sign an attestation over
     `(inputs, output, source, timestamp)`. "Wrong output" then becomes "the signature does not
     verify" or "two attestations conflict" — checkable on-chain with no trusted party. Cheapest
     and highest-leverage; it should come first, because it shrinks how much the remaining
     options have to carry.
  2. **A staked verifier panel** (M-of-N, commit–reveal, minority slashed) for the genuinely
     subjective residue.
  3. Human arbitration for the tail.
- **BitVM2 cannot adjudicate subjective quality — worth stating plainly, because the roadmap
  implied otherwise.** A fraud proof shows that a *deterministic computation* was executed
  correctly. "This price feed was wrong" is a claim about the world, not about a program's
  execution. So `BitVM2Arbiter` is sound only for disputes whose subject is re-executable with
  committed inputs. It ships harm-binding, staking and a snapshotted challenge window so it is
  ready to wire, and the deploy scripts deliberately do **not** grant it `isArbiter`.
- **A malicious or colluding juror can still rule wrongly** within the harm cap. Mitigate by
  running the juror as a multisig and moving toward (1)/(2) above.
- **Replay protection is per-gateway-process — for tool execution.** `InMemoryChallengeStore` is
  correct for a single node; a multi-instance deployment MUST supply a shared `ChallengeStore`
  (Redis/Postgres), or each instance keeps its own nonce set. The interface is public for exactly
  this reason. **The payment leg is no longer affected**: the challenge nonce doubles as the
  ERC-3009 authorization nonce, so the token's `authorizationState` prevents double-charging
  across any number of instances. What a split nonce set still costs you is a duplicate *tool
  execution*, not a duplicate charge.
- **On-chain ERC-8004 feedback is Sybil-able by spec** when deployed permissionless. Deploy with
  `FeedbackAllowlist` (gated mode) or a receipt-gated `IFeedbackAuthorizer`.
- **Two gateways sharing one submitter key will race nonces.** Settlement serializes
  transactions *within* a process, but the daemon and the hosted endpoint are separate processes;
  pointed at the same submitter they can build conflicting nonces and one transaction is dropped.
  The payment is not lost (the authorization stays unspent and the call can be retried), but it is
  a real operational failure mode. Give each gateway its own submitter key, or put a shared nonce
  manager in front.
- **The hosted MCP paywall keeps no server-side challenge state**, by design — see
  `apps/dashboard/lib/x402-paywall.ts`. Challenges are HMAC-signed rather than remembered, and
  replay is prevented by the token's own `authorizationState`. The accepted residue is that two
  *concurrent* requests carrying one fresh authorization can both execute before either settles,
  costing one extra read-only tool run and no double charge.
- **Non-standard tokens.** Fee-on-transfer is handled (balance-delta), but exotic tokens
  (rebasing-down mid-hold, callback-on-transfer) are out of scope — use a vetted stablecoin.
- **Metadata privacy.** Every anchored receipt publishes `keccak256(toolName)`, payer and payee.
  Tool names are trivially rainbow-tabled, so who bought what is public. Fine for a public
  marketplace; not acceptable for confidential workloads without a commitment scheme.
- **Per-call anchoring assumes cheap gas.** At GOAT's current fees a receipt costs ~2.3e-8 BTC,
  which makes per-call settlement genuinely correct engineering. If fees rise, receipts need to be
  batched under a Merkle root — the current design has no batching.

## 6. Mainnet gates (all must be green before real funds)

1. **Redeploy the suite.** The second hardening pass changed storage layouts and signatures; the
   addresses in `deployments/goat-mainnet.json` are the pre-hardening contracts.
2. **Ownership → Timelock + multisig.** *Timelock done; multisig not.* A `TimelockController`
   with a 6-hour delay at `0x14a19a0204a789F5fE1Eb498902D02ec5a8C08AB` **owns all 11 ownable
   contracts** — no EOA owner remains. What is still missing is the *multisig*: the proposer is a
   single EOA, so this buys delay and public visibility, not separation of powers. A compromised
   key can still make any change; it can no longer make one quietly or instantly. Remaining: a
   Safe as proposer, and the deployer's `TIMELOCK_ADMIN_ROLE` renounced.
3. **Grant every role explicitly.** Nothing is implicit any more: recorder, juror, arbiter and
   reporter must each be assigned, or that capability simply does not exist.
4. **Real verification.** *Done.* The gateway verifies every authorization against the chain by
   simulating the transfer (`createErc3009Verify`), so no external facilitator is required and
   `allowUnverifiedPayments` is no longer set anywhere on a real path.
5. **Co-signing wired.** `TIAGOH_PRIVATE_KEY` + `RECEIPT_REGISTRY_ADDRESS` on the gateway, and a
   receipt signer on the client. Without both, receipts are telemetry and buyers have no recourse.
6. **Real payment token.** Point `asset` at a vetted ERC-3009 stablecoin (GOAT mainnet has bridged
   USDC.e at `0x3022b87ac063DE95b1570F46f5e470F8B53112D8`). `DemoToken` is a labeled test token.
7. **Real BitVM2 verifier** (only if using `BitVM2Arbiter`), and only then grant it `isArbiter`.
8. **ERC-8004 gated.** Deploy with a `FeedbackAllowlist` authorizer; allowlist only the gateway.
9. **Static analysis clean.** `slither` shows no high-severity findings.
10. **Independent audit** of the value-moving contracts, findings resolved.

## 7. Reporting

Found something? Do not open a public issue for an exploitable bug. Email the maintainer
(see the repo profile) with a private disclosure and a reproduction.
