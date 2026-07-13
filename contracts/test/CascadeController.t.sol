// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CascadeController} from "../src/CascadeController.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract CascadeControllerTest is Test {
    CascadeController internal cascade;
    MockERC20 internal token;

    address internal owner = address(0xA0);
    address internal buyer = address(0xB0);
    address internal payeeRoot = address(0xC0);
    address internal payeeChild = address(0xD0);

    uint256 internal constant BUDGET = 1_000e6;

    function setUp() public {
        cascade = new CascadeController(owner);
        token = new MockERC20("USD", "USD", 6);
        token.mint(buyer, BUDGET);
        vm.prank(buyer);
        token.approve(address(cascade), BUDGET);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(buyer);
        id = cascade.openCascade(address(token), BUDGET);
    }

    function test_payHops_withAttributionUpTheTree() public {
        uint256 id = _open();

        // Root hop: 400 to payeeRoot.
        vm.prank(buyer);
        uint256 rootHop = cascade.payHop(id, 0, payeeRoot, 400e6, 0);

        // Child hop: 200, 25% (5000... use 2500 bps) attributed up to payeeRoot.
        vm.prank(buyer);
        cascade.payHop(id, rootHop, payeeChild, 200e6, 2500);

        // payeeRoot: 400 + 25% of 200 = 450 ; payeeChild: 150.
        assertEq(token.balanceOf(payeeRoot), 450e6, "root payee");
        assertEq(token.balanceOf(payeeChild), 150e6, "child payee");
        assertEq(cascade.remainingBudget(id), BUDGET - 600e6, "remaining");
    }

    function test_payHop_revertsWhenOverBudget() public {
        uint256 id = _open();
        vm.prank(buyer);
        cascade.payHop(id, 0, payeeRoot, 900e6, 0);

        // Only 100 left; a 200 hop must be rejected on-chain.
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CascadeController.BudgetExceeded.selector, id, 100e6, 200e6
            )
        );
        cascade.payHop(id, 0, payeeChild, 200e6, 0);
    }

    function test_close_refundsUnspent() public {
        uint256 id = _open();
        vm.prank(buyer);
        cascade.payHop(id, 0, payeeRoot, 300e6, 0);

        vm.prank(buyer);
        cascade.close(id);

        assertEq(token.balanceOf(buyer), BUDGET - 300e6, "refund");
        assertEq(cascade.remainingBudget(id), BUDGET - 300e6, "remaining tracked");
    }
}
