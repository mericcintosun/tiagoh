// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {DisputeArbiter} from "../src/DisputeArbiter.sol";
import {QualityBond} from "../src/QualityBond.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Exercises the §5.4 recourse flow: escrow hold -> dispute ruled for buyer ->
///         escrow refunded + bond slashed atomically; plus the atomic cascade unwind.
contract EscrowDisputeTest is Test {
    EscrowVault internal escrow;
    DisputeArbiter internal arbiter;
    QualityBond internal bond;
    MockERC20 internal token;

    address internal owner = address(0xA0);
    address internal buyer = address(0xB0);
    address internal seller = address(0x5E);

    bytes32 internal constant TOOL = keccak256("tool");
    bytes32 internal constant CASCADE = keccak256("cascade-1");

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        escrow = new EscrowVault(owner);
        bond = new QualityBond(address(token), owner);
        arbiter = new DisputeArbiter(owner);

        // Wire the arbiter as the authority over escrow + bond.
        vm.startPrank(owner);
        escrow.setArbiter(address(arbiter), true);
        bond.setArbiter(address(arbiter), true);
        arbiter.setRecourseTargets(address(bond), address(escrow));
        vm.stopPrank();

        // Fund parties.
        token.mint(buyer, 10_000e6);
        token.mint(seller, 10_000e6);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(seller);
        token.approve(address(bond), type(uint256).max);

        // Seller posts a bond.
        vm.prank(seller);
        bond.bond(TOOL, QualityBond.Tier.SILVER);
    }

    function test_dispute_forBuyer_refundsEscrowAndSlashesBond() public {
        // Buyer escrows a conditional payment tagged to the cascade.
        vm.prank(buyer);
        uint256 escrowId = escrow.deposit(seller, address(token), 100e6, 1 days, CASCADE);
        assertEq(token.balanceOf(buyer), 10_000e6 - 100e6, "escrowed");

        // Open + rule the dispute for the buyer.
        uint256 disputeId =
            arbiter.openDispute(keccak256("receipt"), buyer, seller, TOOL, escrowId, 50e6);
        vm.prank(owner);
        arbiter.rule(disputeId, true);

        // Escrow refunded to buyer + 50 slashed from bond to buyer.
        assertEq(token.balanceOf(buyer), 10_000e6 + 50e6, "refund + slash");
        assertEq(bond.bondAmount(TOOL), 450e6, "bond reduced");
    }

    function test_unwindCascade_refundsAllHeldEscrows() public {
        vm.startPrank(buyer);
        escrow.deposit(seller, address(token), 100e6, 1 days, CASCADE);
        escrow.deposit(seller, address(token), 250e6, 1 days, CASCADE);
        vm.stopPrank();
        assertEq(token.balanceOf(buyer), 10_000e6 - 350e6, "two escrows held");

        // Downstream hop fails: arbiter unwinds the whole cascade atomically.
        vm.prank(owner);
        escrow.unwindCascade(CASCADE);

        assertEq(token.balanceOf(buyer), 10_000e6, "all refunded");
        assertEq(escrow.cascadeEscrowCount(CASCADE), 2, "escrows tracked");
    }
}
