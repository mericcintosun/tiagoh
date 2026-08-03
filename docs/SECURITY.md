# tiagoh — Security Model & Mainnet Runbook

This document is the security reference for the tiagoh contract suite. It records the trust
model, the roles, the invariants the tests enforce, the findings fixed during hardening, and the
gates that MUST be cleared before mainnet. It is written to be an auditor's starting point.

> Status: hardened and fully tested (160 Foundry tests — unit, fuzz, invariant; 71 TypeScript
> tests), **not yet independently audited**. The contracts in `src/` are ahead of the addresses in
> `contracts/deployments/goat-mainnet.json`: the second hardening pass below changed storage
> layouts and function signatures, so **the suite must be redeployed** before those addresses
> reflect this document. Do not move real user funds through these contracts until the "Mainnet
> gates" below are all green.

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

### 4c. Static analysis + guarded launch

- **Slither** runs in CI (`.github/workflows/ci.yml`, `slither` job, fail-on high).
- **Guarded launch (no-audit-budget mitigation):** the value at risk per position is capped so a
  pre-audit mainnet bounds any single loss:
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
- **Replay protection is per-gateway-process.** `InMemoryChallengeStore` is correct for a single
  node; a multi-instance deployment MUST supply a shared `ChallengeStore` (Redis/Postgres), or
  each instance keeps its own nonce set. The interface is public for exactly this reason.
- **On-chain ERC-8004 feedback is Sybil-able by spec** when deployed permissionless. Deploy with
  `FeedbackAllowlist` (gated mode) or a receipt-gated `IFeedbackAuthorizer`.
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
2. **Ownership → Timelock + multisig.** `DeployTimelock.s.sol` then `TransferOwnership.s.sol`;
   governance calls `acceptOwnership()` on each contract. No EOA owner in production.
3. **Grant every role explicitly.** Nothing is implicit any more: recorder, juror, arbiter and
   reporter must each be assigned, or that capability simply does not exist.
4. **Real facilitator.** Set `facilitatorUrl` so `createFacilitatorVerify` +
   `createFacilitatorSettle` are live. The gateway refuses to run priced tools unverified unless
   `allowUnverifiedPayments` is set — never set it in production.
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
