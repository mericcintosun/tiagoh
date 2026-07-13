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
}
