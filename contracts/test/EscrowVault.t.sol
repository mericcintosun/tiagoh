// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Settlement-direction and cascade-membership semantics of the escrow vault.
///         These are the rules that decide who gets the money when nobody does anything.
contract EscrowVaultTest is Test {
    EscrowVault internal escrow;
    MockERC20 internal token;

    address internal owner = address(0xA0);
    address internal arbiter = address(0xAB);
    address internal buyer = address(0xB0);
    address internal seller = address(0x5E);
    address internal outsider = address(0xBAD);
    address internal subTool = address(0x51);

    bytes32 internal constant CASCADE = keccak256("cascade-1");
    bytes32 internal constant TOOL = keccak256("tool");

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        escrow = new EscrowVault(owner);

        vm.prank(owner);
        escrow.setArbiter(arbiter, true);

        token.mint(buyer, 10_000e6);
        token.mint(seller, 10_000e6);
        token.mint(outsider, 10_000e6);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(seller);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(outsider);
        token.approve(address(escrow), type(uint256).max);
    }

    function _deposit(address from, uint256 amount, bytes32 cascadeId)
        internal
        returns (uint256 id)
    {
        vm.prank(from);
        id = escrow.deposit(seller, address(token), amount, 1 days, cascadeId, TOOL);
    }

    // ── settlement direction ─────────────────────────────────────────────────

    /// @dev THE fix: silence after the dispute window settles in the SELLER's favour, because
    ///      the seller already delivered. The old contract refunded the buyer here, which let a
    ///      buyer take the output, wait, and reclaim the money for free.
    function test_claim_afterDeadline_paysSeller() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        assertEq(token.balanceOf(seller), 10_000e6, "not yet paid");

        vm.warp(block.timestamp + 1 days);
        vm.prank(seller);
        escrow.claim(id);

        assertEq(token.balanceOf(seller), 10_000e6 + 100e6, "seller settled");
        assertEq(token.balanceOf(buyer), 10_000e6 - 100e6, "buyer paid");
    }

    function test_claim_beforeDeadline_reverts() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.prank(seller);
        vm.expectRevert(EscrowVault.NotExpired.selector);
        escrow.claim(id);
    }

    function test_claim_onlyPayee() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.warp(block.timestamp + 1 days);
        vm.prank(outsider);
        vm.expectRevert(EscrowVault.NotPayee.selector);
        escrow.claim(id);
    }

    /// @dev A buyer must never be able to help themselves to a refund — that is adjudication.
    function test_refund_isArbiterOnly_evenAfterDeadline() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.warp(block.timestamp + 365 days);

        vm.prank(buyer);
        vm.expectRevert(EscrowVault.NotArbiter.selector);
        escrow.refund(id);

        vm.prank(outsider);
        vm.expectRevert(EscrowVault.NotArbiter.selector);
        escrow.refund(id);
    }

    function test_refund_byArbiter_returnsToPayer() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.prank(arbiter);
        escrow.refund(id);
        assertEq(token.balanceOf(buyer), 10_000e6, "refunded");
    }

    function test_release_byPayer_paysSellerEarly() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.prank(buyer);
        escrow.release(id);
        assertEq(token.balanceOf(seller), 10_000e6 + 100e6, "early confirmation");
    }

    function test_ownerIsNotImplicitlyArbiter() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.prank(owner);
        vm.expectRevert(EscrowVault.NotArbiter.selector);
        escrow.refund(id);
    }

    // ── dispute freeze ───────────────────────────────────────────────────────

    function test_freeze_blocksClaimAndRelease() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.prank(arbiter);
        escrow.freeze(id);

        vm.warp(block.timestamp + 1 days);
        vm.prank(seller);
        vm.expectRevert(EscrowVault.Disputed.selector);
        escrow.claim(id);

        vm.prank(buyer);
        vm.expectRevert(EscrowVault.Disputed.selector);
        escrow.release(id);
    }

    function test_unfreeze_restoresClaimPath() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.startPrank(arbiter);
        escrow.freeze(id);
        escrow.unfreeze(id);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        vm.prank(seller);
        escrow.claim(id);
        assertEq(token.balanceOf(seller), 10_000e6 + 100e6, "claim resumed");
    }

    function test_freeze_isArbiterOnly() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.prank(buyer);
        vm.expectRevert(EscrowVault.NotArbiter.selector);
        escrow.freeze(id);
    }

    /// @dev Liveness: a frozen escrow whose arbiter went dark must still be settleable, in the
    ///      default direction, by anyone. Funds can never be locked forever.
    function test_resolveStale_settlesAbandonedEscrowToSeller() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.prank(arbiter);
        escrow.freeze(id);

        vm.warp(block.timestamp + 1 days + 30 days);
        vm.prank(outsider); // permissionless
        escrow.resolveStale(id);

        assertEq(token.balanceOf(seller), 10_000e6 + 100e6, "default direction");
    }

    function test_resolveStale_beforeWindow_reverts() public {
        uint256 id = _deposit(buyer, 100e6, bytes32(0));
        vm.warp(block.timestamp + 1 days + 29 days);
        vm.expectRevert(EscrowVault.NotStale.selector);
        escrow.resolveStale(id);
    }

    // ── cascade membership ───────────────────────────────────────────────────

    /// @dev Griefing fix: an outsider could previously push escrows into a victim's cascadeId,
    ///      bloating the array the arbiter has to unwind — and get their own deposit refunded
    ///      by that very unwind, making the attack free.
    function test_deposit_outsiderCannotJoinAnotherPartysCascade() public {
        _deposit(buyer, 100e6, CASCADE);

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.NotCascadeParticipant.selector, CASCADE, outsider)
        );
        escrow.deposit(seller, address(token), 1, 1 days, CASCADE, TOOL);
    }

    function test_deposit_registrarOwnsTheCascade() public {
        _deposit(buyer, 100e6, CASCADE);
        assertEq(escrow.cascadeRegistrar(CASCADE), buyer, "registrar");
        assertTrue(escrow.isCascadeParticipant(CASCADE, buyer), "registrar is participant");
        assertTrue(escrow.isCascadeParticipant(CASCADE, seller), "payee joins the tree");
    }

    /// @dev The real cascade topology: a tool paid inside the tree goes on to fund its own
    ///      sub-tools within the same tree.
    function test_deposit_payeeMayFundSubHopsOfTheSameCascade() public {
        _deposit(buyer, 100e6, CASCADE);

        vm.prank(seller);
        uint256 subId = escrow.deposit(subTool, address(token), 20e6, 1 days, CASCADE, TOOL);

        assertEq(escrow.cascadeEscrowCount(CASCADE), 2, "sub-hop joined");
        assertTrue(escrow.isCascadeParticipant(CASCADE, subTool), "sub-tool joins too");
        (, address payee,,,,) = escrow.escrowParties(subId);
        assertEq(payee, subTool, "sub-hop payee");
    }

    function test_unwindCascade_refundsAllHeldEscrows() public {
        _deposit(buyer, 100e6, CASCADE);
        _deposit(buyer, 250e6, CASCADE);
        assertEq(token.balanceOf(buyer), 10_000e6 - 350e6, "two escrows held");

        vm.prank(arbiter);
        escrow.unwindCascade(CASCADE);

        assertEq(token.balanceOf(buyer), 10_000e6, "all refunded");
        assertEq(escrow.cascadeEscrowCount(CASCADE), 2, "escrows tracked");
    }

    /// @dev Multi-payer unwind: each hop's own funder is made whole, not the tree's registrar.
    function test_unwindCascade_refundsEachHopToItsOwnPayer() public {
        _deposit(buyer, 100e6, CASCADE);
        vm.prank(seller);
        escrow.deposit(subTool, address(token), 20e6, 1 days, CASCADE, TOOL);

        vm.prank(arbiter);
        escrow.unwindCascade(CASCADE);

        assertEq(token.balanceOf(buyer), 10_000e6, "buyer whole");
        assertEq(token.balanceOf(seller), 10_000e6, "intermediate tool whole");
    }

    // ── input validation ─────────────────────────────────────────────────────

    function test_deposit_rejectsZeroDuration() public {
        vm.prank(buyer);
        vm.expectRevert(EscrowVault.ZeroDuration.selector);
        escrow.deposit(seller, address(token), 1e6, 0, bytes32(0), TOOL);
    }

    function test_deposit_respectsGuardedCap() public {
        vm.prank(owner);
        escrow.setMaxEscrow(50e6);
        vm.prank(buyer);
        vm.expectRevert(EscrowVault.ExceedsCap.selector);
        escrow.deposit(seller, address(token), 51e6, 1 days, bytes32(0), TOOL);
    }
}
