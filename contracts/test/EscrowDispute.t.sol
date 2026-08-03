// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {DisputeArbiter} from "../src/DisputeArbiter.sol";
import {DisputeHarmBinding} from "../src/DisputeHarmBinding.sol";
import {QualityBond} from "../src/QualityBond.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice The §5.4 recourse flow end to end. Two ways to prove harm — a co-signed receipt
///         (instant-settle path) and a held escrow (insured path) — plus the griefing,
///         replay and liveness guards around them.
contract EscrowDisputeTest is Test {
    EscrowVault internal escrow;
    DisputeArbiter internal arbiter;
    QualityBond internal bond;
    ReceiptRegistry internal receipts;
    MockERC20 internal token;

    address internal owner = address(0xA0);
    address internal juror = address(0x1);
    address internal recorder = address(0xF0);

    uint256 internal buyerPk = 0xB0B;
    uint256 internal sellerPk = 0x5E11E4;
    address internal buyer;
    address internal seller;

    bytes32 internal constant TOOL = keccak256("tool");
    bytes32 internal constant CASCADE = keccak256("cascade-1");
    uint256 internal constant STAKE = 5e6;

    function setUp() public {
        buyer = vm.addr(buyerPk);
        seller = vm.addr(sellerPk);

        token = new MockERC20("USD", "USD", 6);
        escrow = new EscrowVault(owner);
        bond = new QualityBond(address(token), owner);
        receipts = new ReceiptRegistry(owner);
        arbiter = new DisputeArbiter(owner, address(token));

        vm.startPrank(owner);
        escrow.setArbiter(address(arbiter), true);
        bond.setArbiter(address(arbiter), true);
        receipts.setRecorder(recorder, true);
        arbiter.setRecourseTargets(address(bond), address(escrow), address(receipts));
        arbiter.setJuror(juror, true);
        arbiter.setDisputeStake(STAKE);
        vm.stopPrank();

        token.mint(buyer, 10_000e6);
        token.mint(seller, 10_000e6);
        vm.startPrank(buyer);
        token.approve(address(escrow), type(uint256).max);
        token.approve(address(arbiter), type(uint256).max);
        vm.stopPrank();
        vm.prank(seller);
        token.approve(address(bond), type(uint256).max);

        vm.prank(seller);
        bond.bond(TOOL, QualityBond.Tier.SILVER); // 500e6
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _receiptInput(bytes32 id, uint256 amount)
        internal
        view
        returns (ReceiptRegistry.ReceiptInput memory)
    {
        return ReceiptRegistry.ReceiptInput({
            receiptId: id,
            parentId: bytes32(0),
            payer: buyer,
            payee: seller,
            token: address(token),
            amount: amount,
            toolId: TOOL
        });
    }

    function _sign(uint256 pk, ReceiptRegistry.ReceiptInput memory r)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, receipts.receiptHash(r));
        return abi.encodePacked(rr, s, v);
    }

    /// @dev Anchors a co-signed receipt exactly as the gateway + client would.
    function _cosign(bytes32 id, uint256 amount) internal returns (bytes32) {
        ReceiptRegistry.ReceiptInput memory r = _receiptInput(id, amount);
        receipts.anchorReceipt(r, _sign(buyerPk, r), _sign(sellerPk, r));
        return id;
    }

    function _escrowDeposit(uint256 amount) internal returns (uint256 id) {
        vm.prank(buyer);
        id = escrow.deposit(seller, address(token), amount, 1 days, CASCADE, TOOL);
    }

    // ── receipt-bound recourse (the instant-settle path) ─────────────────────

    /// @dev The capability that was previously unreachable: the call settled instantly, no
    ///      escrow exists, and the buyer's recourse comes out of the seller's bond.
    function test_receiptDispute_slashesBondWithNoEscrow() public {
        bytes32 receiptId = _cosign(keccak256("r1"), 40e6);

        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(receiptId, 0, 40e6);
        vm.prank(juror);
        arbiter.rule(disputeId, true);

        // Slash routed to the buyer, and the dispute stake came back.
        assertEq(token.balanceOf(buyer), 10_000e6 + 40e6, "compensated from bond");
        assertEq(bond.bondAmount(TOOL), 500e6 - 40e6, "bond reduced");
    }

    /// @dev A receipt the seller's own gateway wrote proves nothing — only a mutually signed
    ///      one is evidence. Without this, a seller could not be protected from a buyer, nor a
    ///      buyer from a seller.
    function test_receiptDispute_rejectsRecorderWrittenReceipt() public {
        bytes32 receiptId = keccak256("telemetry");
        vm.prank(recorder);
        receipts.recordReceipt(receiptId, bytes32(0), buyer, seller, address(token), 40e6, TOOL);

        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.ReceiptNotCosigned.selector);
        arbiter.openDispute(receiptId, 0, 40e6);
    }

    function test_receiptDispute_onlyThePayerMayDispute() public {
        bytes32 receiptId = _cosign(keccak256("r2"), 40e6);

        vm.prank(seller);
        vm.expectRevert(DisputeHarmBinding.ReceiptNotBuyers.selector);
        arbiter.openDispute(receiptId, 0, 40e6);
    }

    function test_receiptDispute_slashCappedToReceiptAmount() public {
        bytes32 receiptId = _cosign(keccak256("r3"), 10e6);

        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.SlashExceedsHarm.selector);
        arbiter.openDispute(receiptId, 0, 11e6);
    }

    function test_receiptDispute_slashCappedToLiveBond() public {
        bytes32 receiptId = _cosign(keccak256("r4"), 900e6);

        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.SlashExceedsBond.selector);
        arbiter.openDispute(receiptId, 0, 600e6); // bond is 500e6
    }

    /// @dev Replay guard: without it a buyer could re-dispute one bad call until the seller's
    ///      whole bond was gone.
    function test_receiptDispute_cannotBeReLitigated() public {
        bytes32 receiptId = _cosign(keccak256("r5"), 40e6);

        vm.startPrank(buyer);
        uint256 disputeId = arbiter.openDispute(receiptId, 0, 40e6);
        vm.expectRevert(DisputeHarmBinding.AlreadyDisputed.selector);
        arbiter.openDispute(receiptId, 0, 40e6);
        vm.stopPrank();

        vm.prank(juror);
        arbiter.rule(disputeId, true);

        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.AlreadyDisputed.selector);
        arbiter.openDispute(receiptId, 0, 40e6);
    }

    /// @dev Staleness guard: a year-old call cannot be dragged up against today's bond.
    function test_receiptDispute_closesAfterDisputeWindow() public {
        bytes32 receiptId = _cosign(keccak256("r6"), 40e6);
        vm.warp(block.timestamp + 3 days + 1);

        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.DisputeWindowClosed.selector);
        arbiter.openDispute(receiptId, 0, 40e6);
    }

    function test_openDispute_requiresSomeHarm() public {
        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.NoHarm.selector);
        arbiter.openDispute(bytes32(0), 0, 0);
    }

    // ── escrow-bound recourse (the insured path) ─────────────────────────────

    function test_escrowDispute_forBuyer_refundsEscrowAndSlashesBond() public {
        uint256 escrowId = _escrowDeposit(100e6);
        assertEq(token.balanceOf(buyer), 10_000e6 - 100e6, "escrowed");

        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(bytes32(0), escrowId, 50e6);
        assertEq(token.balanceOf(buyer), 10_000e6 - 100e6 - STAKE, "stake posted");

        vm.prank(juror);
        arbiter.rule(disputeId, true);

        // escrow refunded + 50 slashed to the buyer + stake returned
        assertEq(token.balanceOf(buyer), 10_000e6 + 50e6, "refund + slash + stake back");
        assertEq(bond.bondAmount(TOOL), 450e6, "bond reduced");
    }

    /// @dev Griefing cost: a dispute the buyer loses pays their stake to the seller.
    function test_escrowDispute_forSeller_forfeitsStakeAndUnfreezes() public {
        uint256 escrowId = _escrowDeposit(100e6);

        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(bytes32(0), escrowId, 50e6);
        vm.prank(juror);
        arbiter.rule(disputeId, false);

        assertEq(token.balanceOf(seller), 10_000e6 - 500e6 + STAKE, "stake forfeited to seller");
        assertEq(bond.bondAmount(TOOL), 500e6, "bond untouched");

        // The freeze is lifted, so the seller's normal claim path resumes.
        vm.warp(block.timestamp + 1 days);
        vm.prank(seller);
        escrow.claim(escrowId);
        assertEq(token.balanceOf(seller), 10_000e6 - 500e6 + STAKE + 100e6, "claimed");
    }

    function test_escrowDispute_onlyTheFunderMayDispute() public {
        uint256 escrowId = _escrowDeposit(100e6);
        vm.prank(seller);
        vm.expectRevert(DisputeHarmBinding.EscrowMismatch.selector);
        arbiter.openDispute(bytes32(0), escrowId, 0);
    }

    function test_escrowDispute_freezesTheEscrow() public {
        uint256 escrowId = _escrowDeposit(100e6);
        vm.prank(buyer);
        arbiter.openDispute(bytes32(0), escrowId, 0);

        vm.warp(block.timestamp + 1 days);
        vm.prank(seller);
        vm.expectRevert(EscrowVault.Disputed.selector);
        escrow.claim(escrowId);
    }

    function test_escrowDispute_cannotBeReLitigated() public {
        uint256 escrowId = _escrowDeposit(100e6);
        vm.startPrank(buyer);
        arbiter.openDispute(bytes32(0), escrowId, 0);
        vm.expectRevert(DisputeHarmBinding.AlreadyDisputed.selector);
        arbiter.openDispute(bytes32(0), escrowId, 0);
        vm.stopPrank();
    }

    // ── combined evidence ────────────────────────────────────────────────────

    /// @dev A call that is both escrowed and receipted must not let the buyer double-count the
    ///      harm; the cap is the larger of the two, not their sum.
    function test_combinedEvidence_harmIsNotDoubleCounted() public {
        uint256 escrowId = _escrowDeposit(100e6);
        bytes32 receiptId = _cosign(keccak256("r7"), 40e6);

        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.SlashExceedsHarm.selector);
        arbiter.openDispute(receiptId, escrowId, 101e6);

        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(receiptId, escrowId, 100e6);
        assertGt(disputeId, 0, "opened at the larger harm");
    }

    /// @dev Evidence naming two different sellers is incoherent and must be rejected.
    function test_combinedEvidence_rejectsMismatchedParties() public {
        uint256 escrowId = _escrowDeposit(100e6);

        address otherSeller = address(0xDEAD);
        ReceiptRegistry.ReceiptInput memory r = _receiptInput(keccak256("r8"), 40e6);
        r.payee = otherSeller;
        // Sign the mismatched receipt with a key that actually controls `otherSeller`.
        uint256 otherPk = 0xDEADBEEF;
        r.payee = vm.addr(otherPk);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(otherPk, receipts.receiptHash(r));
        receipts.anchorReceipt(r, _sign(buyerPk, r), abi.encodePacked(rr, s, v));

        vm.prank(buyer);
        vm.expectRevert(DisputeHarmBinding.PartyMismatch.selector);
        arbiter.openDispute(r.receiptId, escrowId, 0);
    }

    // ── juror authority + liveness ───────────────────────────────────────────

    /// @dev `rule` moves value, so the owner key must not be able to call it.
    function test_rule_ownerIsNotImplicitlyJuror() public {
        bytes32 receiptId = _cosign(keccak256("r9"), 40e6);
        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(receiptId, 0, 40e6);

        vm.prank(owner);
        vm.expectRevert(DisputeArbiter.NotJuror.selector);
        arbiter.rule(disputeId, true);
    }

    function test_rule_afterRulingWindow_reverts() public {
        bytes32 receiptId = _cosign(keccak256("r10"), 40e6);
        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(receiptId, 0, 40e6);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(juror);
        vm.expectRevert(DisputeArbiter.RulingWindowClosed.selector);
        arbiter.rule(disputeId, true);
    }

    /// @dev Liveness: a silent juror must not be able to strand the buyer's stake or keep the
    ///      seller's escrow frozen forever.
    function test_expire_returnsStakeAndUnfreezes() public {
        uint256 escrowId = _escrowDeposit(100e6);
        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(bytes32(0), escrowId, 50e6);
        assertEq(token.balanceOf(buyer), 10_000e6 - 100e6 - STAKE, "stake posted");

        vm.warp(block.timestamp + 7 days + 1);
        arbiter.expire(disputeId); // permissionless

        assertEq(token.balanceOf(buyer), 10_000e6 - 100e6, "stake returned");
        vm.prank(seller);
        escrow.claim(escrowId);
        assertEq(token.balanceOf(seller), 10_000e6 - 500e6 + 100e6, "seller settled");
    }

    function test_expire_beforeWindow_reverts() public {
        bytes32 receiptId = _cosign(keccak256("r11"), 40e6);
        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(receiptId, 0, 40e6);

        vm.expectRevert(DisputeArbiter.RulingWindowOpen.selector);
        arbiter.expire(disputeId);
    }

    function test_rule_isTerminal() public {
        bytes32 receiptId = _cosign(keccak256("r12"), 40e6);
        vm.prank(buyer);
        uint256 disputeId = arbiter.openDispute(receiptId, 0, 40e6);

        vm.startPrank(juror);
        arbiter.rule(disputeId, true);
        vm.expectRevert(DisputeArbiter.NotOpen.selector);
        arbiter.rule(disputeId, false);
        vm.stopPrank();
    }
}
