// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SessionKeyDelegator} from "../src/SessionKeyDelegator.sol";
import {BitVM2Arbiter} from "../src/BitVM2Arbiter.sol";
import {DisputeHarmBinding} from "../src/DisputeHarmBinding.sol";
import {ERC8004ReputationRegistry} from "../src/ERC8004ReputationRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract SessionKeyDelegatorTest is Test {
    SessionKeyDelegator del;
    uint256 constant SK_PK = 0xA11CE;
    address sk;
    address parent = address(0xBEEF);

    function setUp() public {
        del = new SessionKeyDelegator();
        sk = vm.addr(SK_PK);
        vm.prank(parent);
        del.grant(sk, 1000, 0);
    }

    function _epoch() internal view returns (uint256 e) {
        (,,,, e) = del.sessions(parent, sk);
    }

    /// @dev Spend authorizations are EIP-712 typed digests (chainId + contract + epoch bound).
    function _sig(uint256 amount, uint256 nonce) internal view returns (bytes memory) {
        return _sigAt(amount, nonce, _epoch());
    }

    function _sigAt(uint256 amount, uint256 nonce, uint256 epoch)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(SK_PK, del.spendHash(parent, amount, nonce, epoch));
        return abi.encodePacked(r, s, v);
    }

    function test_spend_withinCap_recoversSessionKey() public {
        address recovered = del.spend(parent, 400, 0, _epoch(), _sig(400, 0));
        assertEq(recovered, sk);
        assertEq(del.remaining(parent, sk), 600);
    }

    function test_spend_overCap_reverts() public {
        uint256 e = _epoch();
        del.spend(parent, 400, 0, e, _sig(400, 0));
        bytes memory sig = _sigAt(700, 1, e); // compute before expectRevert (spendHash is an external call)
        vm.expectRevert(abi.encodeWithSelector(SessionKeyDelegator.CapExceeded.selector, 600, 700));
        del.spend(parent, 700, 1, e, sig);
    }

    function test_spend_badNonce_reverts() public {
        uint256 e = _epoch();
        bytes memory sig = _sigAt(100, 5, e);
        vm.expectRevert(SessionKeyDelegator.BadNonce.selector);
        del.spend(parent, 100, 5, e, sig);
    }

    function test_revoke_blocksSpend() public {
        uint256 e = _epoch();
        bytes memory sig = _sigAt(100, 0, e);
        vm.prank(parent);
        del.revoke(sk);
        vm.expectRevert(SessionKeyDelegator.NotActive.selector);
        del.spend(parent, 100, 0, e, sig);
    }

    /// @dev A re-grant is a FRESH allowance: prior spend is cleared, nonces are not, and the
    ///      epoch bumps so old signatures are permanently dead.
    function test_grant_resetsSpent_keepsNonces() public {
        uint256 e0 = _epoch();
        del.spend(parent, 400, 0, e0, _sigAt(400, 0, e0));
        assertEq(del.remaining(parent, sk), 600);

        vm.prank(parent);
        del.grant(sk, 1000, 0);
        assertEq(del.remaining(parent, sk), 1000, "fresh allowance");

        // The already-used nonce-0 signature (old epoch) can never replay.
        bytes memory stale = _sigAt(400, 0, e0); // precompute (spendHash is an external call)
        vm.expectRevert(SessionKeyDelegator.BadEpoch.selector);
        del.spend(parent, 400, 0, e0, stale);

        // The next nonce works against the fresh cap under the new epoch.
        uint256 e1 = _epoch();
        del.spend(parent, 900, 1, e1, _sigAt(900, 1, e1));
        assertEq(del.remaining(parent, sk), 100);
    }

    /// @dev F1 fix: a spend signed under one grant but never submitted must NOT resurrect after
    ///      revoke → re-grant, because the epoch changed.
    function test_revokeThenGrant_killsUnsubmittedPreSignedSpend() public {
        uint256 e0 = _epoch();
        bytes memory pending = _sigAt(500, 0, e0); // signed but never submitted

        vm.prank(parent);
        del.revoke(sk); // epoch bumps
        vm.prank(parent);
        del.grant(sk, 1000, 0); // fresh grant, epoch bumps again

        vm.expectRevert(SessionKeyDelegator.BadEpoch.selector);
        del.spend(parent, 500, 0, e0, pending);
    }

    function test_grant_pastExpiry_reverts() public {
        vm.warp(100);
        vm.prank(parent);
        vm.expectRevert(SessionKeyDelegator.BadExpiry.selector);
        del.grant(sk, 1000, 99);
    }
}

contract MockVerifier {
    bool public fraud;

    function setFraud(bool f) external {
        fraud = f;
    }

    function verifyChallenge(bytes32, bytes calldata) external view returns (bool) {
        return fraud;
    }
}

/// @dev Stateful bond mock: exposes the `bonds` / `bondAmount` read surface the hardened
///      arbiters validate against, plus the recording `slash`.
contract MockBond {
    address public seller;
    uint256 public amount;
    uint256 public slashed;
    address public to;

    function set(address seller_, uint256 amount_) external {
        seller = seller_;
        amount = amount_;
    }

    function bonds(bytes32) external view returns (address, uint256, uint8, bool, uint256) {
        return (seller, amount, 2, true, 0);
    }

    function bondAmount(bytes32) external view returns (uint256) {
        return amount;
    }

    function slash(bytes32, uint256 amt, address to_) external {
        slashed = amt;
        to = to_;
        amount -= amt;
    }
}

/// @dev Stateful escrow mock: exposes the `escrowParties` read surface (state 1 = HELD) with an
///      amount, so harm-binding (slash <= escrow.amount) can be exercised, plus the freeze /
///      unfreeze / refund writes an arbiter drives.
contract MockEscrow {
    address public payer;
    address public payee;
    uint256 public amount;
    bytes32 public toolId;
    uint8 public state;
    bool public disputed;
    uint256 public refunded;

    function set(address payer_, address payee_, uint256 amount_, uint8 state_) external {
        payer = payer_;
        payee = payee_;
        amount = amount_;
        state = state_;
    }

    function setTool(bytes32 toolId_) external {
        toolId = toolId_;
    }

    function escrowParties(uint256)
        external
        view
        returns (address, address, uint256, bytes32, uint8, bool)
    {
        return (payer, payee, amount, toolId, state, disputed);
    }

    function refund(uint256 escrowId) external {
        refunded = escrowId;
        state = 3; // REFUNDED
        disputed = false;
    }

    function release(uint256) external {
        state = 2; // RELEASED
        disputed = false;
    }

    function freeze(uint256) external {
        disputed = true;
    }

    function unfreeze(uint256) external {
        disputed = false;
    }
}

/// @dev Receipt-evidence mock: lets the arbiter tests drive the co-signed receipt path without
///      standing up a full registry + signatures.
contract MockReceipts {
    address public payer;
    address public payee;
    uint256 public amount;
    bytes32 public toolId;
    uint64 public timestamp;
    bool public cosigned;

    function set(
        address payer_,
        address payee_,
        uint256 amount_,
        bytes32 toolId_,
        uint64 timestamp_,
        bool cosigned_
    ) external {
        payer = payer_;
        payee = payee_;
        amount = amount_;
        toolId = toolId_;
        timestamp = timestamp_;
        cosigned = cosigned_;
    }

    function receiptEvidence(bytes32)
        external
        view
        returns (address, address, uint256, bytes32, uint64, bool)
    {
        return (payer, payee, amount, toolId, timestamp, cosigned);
    }
}

contract ERC8004ReputationRegistryTest is Test {
    ERC8004ReputationRegistry reg;
    address tool = address(0x700);
    address payer = address(0xdA11);

    function setUp() public {
        reg = new ERC8004ReputationRegistry(address(0)); // permissionless (ERC-8004 default)
    }

    function test_register_mintsSequentialIds() public {
        uint256 id = reg.registerAgent(tool);
        assertEq(id, 1);
        assertEq(reg.agentOf(tool), 1);
        assertEq(reg.subjectOf(1), tool);
    }

    function test_giveFeedback_aggregatesSummary() public {
        uint256 id = reg.registerAgent(tool);
        vm.prank(payer);
        reg.giveFeedback(
            id, 100, 0, "tiagoh", "success", "https://tool/mcp", "receipt:1", bytes32(uint256(1))
        );
        vm.prank(payer);
        reg.giveFeedback(
            id, -100, 0, "tiagoh", "dispute", "https://tool/mcp", "receipt:2", bytes32(uint256(2))
        );
        (uint64 count, int256 sumWad, int256 avgWad) = reg.getSummary(id);
        assertEq(count, 2);
        assertEq(sumWad, 0); // +100 and -100 cancel, normalized to WAD
        assertEq(avgWad, 0);
        assertEq(reg.clientCount(id), 1);
    }

    function test_selfFeedback_reverts() public {
        uint256 id = reg.registerAgent(tool);
        vm.prank(tool);
        vm.expectRevert(ERC8004ReputationRegistry.SelfFeedback.selector);
        reg.giveFeedback(id, 100, 0, "tiagoh", "success", "", "", bytes32(0));
    }

    function test_feedback_unknownAgent_reverts() public {
        vm.prank(payer);
        vm.expectRevert(ERC8004ReputationRegistry.AgentUnknown.selector);
        reg.giveFeedback(999, 100, 0, "tiagoh", "success", "", "", bytes32(0));
    }

    function test_revoke_dropsFromSummary() public {
        uint256 id = reg.registerAgent(tool);
        vm.prank(payer);
        uint64 idx = reg.giveFeedback(id, 100, 0, "tiagoh", "success", "", "", bytes32(0));
        vm.prank(payer);
        reg.revokeFeedback(id, idx);
        (uint64 count,,) = reg.getSummary(id);
        assertEq(count, 0);
    }
}

contract BitVM2ArbiterTest is Test {
    BitVM2Arbiter arb;
    MockBond bond;
    MockEscrow escrow;
    MockReceipts receipts;
    MockVerifier verifier;
    MockERC20 stake;

    address buyer = address(0xB1);
    address seller = address(0x5E);
    address challenger = address(0xCA11);
    bytes32 toolId = keccak256("tool");
    bytes32 subject = keccak256("receipt");
    uint256 constant STAKE = 10e6;

    function setUp() public {
        stake = new MockERC20("USD", "USD", 6);
        arb = new BitVM2Arbiter(address(this), address(stake), STAKE);
        bond = new MockBond();
        escrow = new MockEscrow();
        receipts = new MockReceipts();
        verifier = new MockVerifier();
        arb.setRecourseTargets(address(bond), address(escrow), address(receipts));
        arb.setVerifier(address(verifier));

        // A real held escrow (buyer -> seller), a live bond for the tool's seller, and a
        // co-signed receipt for the same interaction.
        escrow.set(buyer, seller, 500, 1);
        escrow.setTool(toolId);
        bond.set(seller, 500);
        receipts.set(buyer, seller, 500, toolId, uint64(block.timestamp), true);

        // This contract is the proposer; fund + approve the proposal stake.
        stake.mint(address(this), 100e6);
        stake.approve(address(arb), type(uint256).max);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(buyer);
        id = arb.openDispute(bytes32(0), 7, 300);
    }

    // ── open-time validation ────────────────────────────────────────────────

    /// @dev The buyer is `msg.sender` by construction, so a third party cannot open a dispute
    ///      on someone else's harm — the escrow simply isn't theirs.
    function test_openDispute_nonFunderCannotDispute_reverts() public {
        vm.expectRevert(DisputeHarmBinding.EscrowMismatch.selector);
        arb.openDispute(bytes32(0), 7, 300);
    }

    function test_openDispute_escrowMismatch_reverts() public {
        escrow.set(address(0xDEAD), seller, 500, 1); // not the buyer's escrow
        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.EscrowMismatch.selector);
        arb.openDispute(bytes32(0), 7, 300);
    }

    function test_openDispute_slashExceedsBond_reverts() public {
        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.SlashExceedsBond.selector);
        arb.openDispute(bytes32(0), 7, 600); // bond is 500
    }

    /// @dev C1 fix: a slash can never exceed the harm the buyer actually proved.
    function test_openDispute_slashExceedsHarm_reverts() public {
        escrow.set(buyer, seller, 200, 1); // only 200 escrowed
        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.SlashExceedsHarm.selector);
        arb.openDispute(bytes32(0), 7, 300); // slash 300 > harm 200
    }

    /// @dev C1 fix: a bare slash backed by no evidence at all (the free-bond-theft vector).
    function test_openDispute_withoutAnyHarm_reverts() public {
        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.NoHarm.selector);
        arb.openDispute(bytes32(0), 0, 300);
    }

    /// @dev The instant-settle path: harm proven by a co-signed receipt, no escrow involved.
    function test_openDispute_acceptsCosignedReceiptWithoutEscrow() public {
        vm.prank(buyer);
        uint256 id = arb.openDispute(subject, 0, 300);

        arb.propose(id, true);
        vm.warp(block.timestamp + 2 hours);
        arb.rule(id, true);

        assertEq(escrow.refunded(), 0, "no escrow to refund");
        assertEq(bond.slashed(), 300, "recourse came from the bond");
        assertEq(bond.to(), buyer, "routed to the buyer");
    }

    /// @dev A unilaterally-written receipt is telemetry, not evidence.
    function test_openDispute_rejectsUncosignedReceipt() public {
        receipts.set(buyer, seller, 500, toolId, uint64(block.timestamp), false);
        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.ReceiptNotCosigned.selector);
        arb.openDispute(subject, 0, 300);
    }

    function test_openDispute_receiptMustNameTheDisputer() public {
        receipts.set(address(0xDEAD), seller, 500, toolId, uint64(block.timestamp), true);
        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.ReceiptNotBuyers.selector);
        arb.openDispute(subject, 0, 300);
    }

    function test_openDispute_sameHarmCannotBeReLitigated() public {
        _open();
        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.AlreadyDisputed.selector);
        arb.openDispute(bytes32(0), 7, 300);
    }

    /// @dev Opening a dispute freezes the escrow so neither party can settle around the arbiter.
    function test_openDispute_freezesTheEscrow() public {
        _open();
        assertTrue(escrow.disputed(), "frozen for the duration of the dispute");
    }

    // ── propose ─────────────────────────────────────────────────────────────

    function test_propose_requiresVerifier() public {
        uint256 id = _open();
        arb.setVerifier(address(0));
        vm.expectRevert(BitVM2Arbiter.NoVerifier.selector);
        arb.propose(id, true);
    }

    function test_propose_pullsStake() public {
        uint256 id = _open();
        uint256 before = stake.balanceOf(address(this));
        arb.propose(id, true);
        assertEq(stake.balanceOf(address(this)), before - STAKE, "stake escrowed");
        assertEq(stake.balanceOf(address(arb)), STAKE);
    }

    // ── optimistic finalize ─────────────────────────────────────────────────

    function test_optimistic_ruleForBuyer_afterWindow_refundsAndSlashes() public {
        uint256 id = _open();
        arb.propose(id, true);
        // cannot rule before the window
        vm.expectRevert(BitVM2Arbiter.WindowNotElapsed.selector);
        arb.rule(id, true);
        uint256 before = stake.balanceOf(address(this));
        vm.warp(block.timestamp + 2 hours);
        arb.rule(id, true);
        assertEq(escrow.refunded(), 7);
        assertEq(bond.slashed(), 300);
        assertEq(bond.to(), buyer);
        assertEq(stake.balanceOf(address(this)), before + STAKE, "stake returned to proposer");
    }

    /// @dev Recourse must degrade gracefully: an escrow released after open is skipped,
    ///      the slash still executes, and the dispute can never get stuck.
    function test_finalize_graceful_whenEscrowNoLongerHeld() public {
        uint256 id = _open();
        arb.propose(id, true);
        escrow.set(buyer, seller, 500, 2); // RELEASED after the dispute was opened
        vm.warp(block.timestamp + 2 hours);
        arb.rule(id, true);
        assertEq(escrow.refunded(), 0, "released escrow not refunded");
        assertEq(bond.slashed(), 300, "slash still executed");
    }

    // ── challenge ───────────────────────────────────────────────────────────

    function test_challenge_provenFraud_flipsRuling_paysChallenger() public {
        uint256 id = _open();
        arb.propose(id, true); // proposed for buyer
        verifier.setFraud(true); // the challenge proves the proposal was fraudulent
        vm.prank(challenger);
        arb.challenge(id, hex"01");
        // ruling flipped to seller → no refund/slash; challenger takes the proposer stake
        assertEq(escrow.refunded(), 0);
        assertEq(bond.slashed(), 0);
        assertEq(stake.balanceOf(challenger), STAKE, "challenger paid from proposer stake");
    }

    /// @dev A FAILED challenge must revert, not finalize: otherwise the proposer could
    ///      self-challenge with a junk proof and skip the challenge window entirely.
    function test_challenge_noFraud_reverts_windowStays() public {
        uint256 id = _open();
        arb.propose(id, true);
        verifier.setFraud(false);
        vm.expectRevert(BitVM2Arbiter.ChallengeFailed.selector);
        arb.challenge(id, hex"01");

        // The proposal is still live and finalizes normally after the window.
        vm.warp(block.timestamp + 2 hours);
        arb.rule(id, true);
        assertEq(escrow.refunded(), 7);
        assertEq(bond.slashed(), 300);
    }

    // ── config guards ───────────────────────────────────────────────────────

    function test_setChallengeWindow_belowMinimum_reverts() public {
        vm.expectRevert(BitVM2Arbiter.WindowTooShort.selector);
        arb.setChallengeWindow(30 minutes);
    }
}
