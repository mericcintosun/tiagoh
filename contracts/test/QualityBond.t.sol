// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QualityBond} from "../src/QualityBond.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract QualityBondTest is Test {
    QualityBond internal bondContract;
    MockERC20 internal token;

    address internal owner = address(0xA0);
    address internal arbiter = address(0xAB);
    address internal seller = address(0x5E);
    address internal buyer = address(0xB0);

    bytes32 internal constant TOOL = keccak256("tool:defi-data");

    function setUp() public {
        bondContract = new QualityBond(address(token = new MockERC20("USD", "USD", 6)), owner);
        vm.prank(owner);
        bondContract.setArbiter(arbiter, true);

        token.mint(seller, 10_000e6);
        vm.prank(seller);
        token.approve(address(bondContract), type(uint256).max);
    }

    function test_bond_locksStake() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.SILVER);
        assertEq(bondContract.bondAmount(TOOL), 500e6, "silver stake");
        assertEq(token.balanceOf(address(bondContract)), 500e6, "held");
    }

    function test_slash_refundsBuyer() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.SILVER);

        vm.prank(arbiter);
        bondContract.slash(TOOL, 200e6, buyer);

        assertEq(token.balanceOf(buyer), 200e6, "buyer refunded from bond");
        assertEq(bondContract.bondAmount(TOOL), 300e6, "remaining bond");
    }

    function test_slash_onlyArbiter() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.BRONZE);
        vm.expectRevert(QualityBond.NotArbiter.selector);
        vm.prank(buyer);
        bondContract.slash(TOOL, 1, buyer);
    }

    function test_withdraw_afterCooldown() public {
        vm.startPrank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.BRONZE);
        bondContract.startUnbond(TOOL);

        vm.expectRevert(QualityBond.CooldownNotElapsed.selector);
        bondContract.withdraw(TOOL);

        vm.warp(block.timestamp + 7 days + 1);
        bondContract.withdraw(TOOL);
        vm.stopPrank();

        assertEq(token.balanceOf(seller), 10_000e6, "full stake returned");
        assertEq(bondContract.bondAmount(TOOL), 0, "bond cleared");
    }

    // ── anti-whitewashing ────────────────────────────────────────────────────

    /// @dev A seller who sees a ruling land must not be able to pull the rest of their
    ///      collateral straight away, leaving nothing behind for the next harmed buyer.
    function test_slash_locksRemainingStakeForTheSlashCooldown() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.SILVER);

        vm.prank(arbiter);
        bondContract.slash(TOOL, 200e6, buyer);

        vm.startPrank(seller);
        bondContract.startUnbond(TOOL);
        vm.warp(block.timestamp + 7 days + 1); // normal cooldown elapsed…
        vm.expectRevert(QualityBond.SlashCooldownNotElapsed.selector);
        bondContract.withdraw(TOOL); // …but the slash lock still holds

        vm.warp(block.timestamp + 30 days);
        bondContract.withdraw(TOOL);
        vm.stopPrank();

        assertEq(bondContract.bondAmount(TOOL), 0, "eventually withdrawable");
    }

    /// @dev The slash record is per identity and permanent: cycling the bond does not erase it,
    ///      so "abandon and re-register" leaves a trace an indexer can price in.
    function test_slashHistory_survivesUnbondAndWithdraw() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.SILVER);
        vm.prank(arbiter);
        bondContract.slash(TOOL, 200e6, buyer);

        vm.startPrank(seller);
        bondContract.startUnbond(TOOL);
        vm.warp(block.timestamp + 38 days);
        bondContract.withdraw(TOOL);
        vm.stopPrank();

        assertEq(bondContract.bondAmount(TOOL), 0, "bond gone");
        assertEq(bondContract.totalSlashed(seller), 200e6, "history retained");
        assertEq(bondContract.slashCount(seller), 1, "slash count retained");
    }

    /// @dev After a slash a seller must be able to restore standing by re-collateralizing,
    ///      rather than being pushed toward abandoning the identity.
    function test_topUp_restoresCollateral() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.SILVER);
        vm.prank(arbiter);
        bondContract.slash(TOOL, 200e6, buyer);
        assertEq(bondContract.bondAmount(TOOL), 300e6, "reduced");

        vm.prank(seller);
        bondContract.topUp(TOOL, 200e6);
        assertEq(bondContract.bondAmount(TOOL), 500e6, "restored");
    }

    function test_topUp_onlySeller() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.SILVER);

        token.mint(buyer, 100e6);
        vm.startPrank(buyer);
        token.approve(address(bondContract), type(uint256).max);
        vm.expectRevert(QualityBond.NotSeller.selector);
        bondContract.topUp(TOOL, 100e6);
        vm.stopPrank();
    }

    /// @dev Topping up an unbonding bond would let a seller dodge the cooldown they started.
    function test_topUp_rejectedWhileUnbonding() public {
        vm.startPrank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.SILVER);
        bondContract.startUnbond(TOOL);
        vm.expectRevert(QualityBond.AlreadyUnbonding.selector);
        bondContract.topUp(TOOL, 100e6);
        vm.stopPrank();
    }

    function test_withdrawableAt_reflectsBothLocks() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.SILVER);
        vm.prank(arbiter);
        bondContract.slash(TOOL, 1e6, buyer);
        uint256 slashLock = block.timestamp + 30 days;

        vm.prank(seller);
        bondContract.startUnbond(TOOL);

        assertEq(bondContract.withdrawableAt(TOOL), slashLock, "slash lock dominates");
    }

    function test_ownerIsNotImplicitlySlasher() public {
        vm.prank(seller);
        bondContract.bond(TOOL, QualityBond.Tier.BRONZE);
        vm.prank(owner);
        vm.expectRevert(QualityBond.NotArbiter.selector);
        bondContract.slash(TOOL, 1, buyer);
    }
}
