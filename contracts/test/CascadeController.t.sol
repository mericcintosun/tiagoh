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
    address internal outsider = address(0xBAD);

    uint256 internal constant BUDGET = 1_000e6;
    uint256 internal constant DURATION = 1 days;

    function setUp() public {
        cascade = new CascadeController(owner);
        token = new MockERC20("USD", "USD", 6);
        token.mint(buyer, BUDGET);
        vm.prank(buyer);
        token.approve(address(cascade), BUDGET);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(buyer);
        id = cascade.openCascade(address(token), BUDGET, DURATION);
    }

    // ── budget + attribution ─────────────────────────────────────────────────

    function test_payHops_withAttributionUpTheTree() public {
        uint256 id = _open();

        vm.prank(buyer);
        uint256 rootHop = cascade.payHop(id, 0, payeeRoot, 400e6, 0);

        // Child hop: 200, 25% attributed up to payeeRoot.
        vm.prank(buyer);
        cascade.payHop(id, rootHop, payeeChild, 200e6, 2500);

        assertEq(token.balanceOf(payeeRoot), 450e6, "root payee");
        assertEq(token.balanceOf(payeeChild), 150e6, "child payee");
        assertEq(cascade.remainingBudget(id), BUDGET - 600e6, "remaining");
    }

    function test_payHop_revertsWhenOverBudget() public {
        uint256 id = _open();
        vm.prank(buyer);
        cascade.payHop(id, 0, payeeRoot, 900e6, 0);

        // Only 100 left; a 200 hop must be rejected on-chain. The opener's allowance is the
        // binding constraint here (it tracks the budget one-to-one for the opener).
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(CascadeController.AllowanceExceeded.selector, id, 100e6, 200e6)
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
    }

    // ── delegated sub-budgets (agent hires agent) ────────────────────────────

    /// @dev The capability the old opener-only design could not express: a paid tool discovers
    ///      at runtime that it needs a sub-tool, and pays for it out of a capped slice.
    function test_delegate_letsAPaidToolHireSubTools() public {
        uint256 id = _open();

        vm.startPrank(buyer);
        uint256 rootHop = cascade.payHop(id, 0, payeeRoot, 400e6, 0);
        cascade.delegate(id, payeeRoot, 100e6); // capped sub-budget for the tool
        vm.stopPrank();

        assertEq(cascade.allowance(id, payeeRoot), 100e6, "delegated");

        // The tool now pays its own sub-tool, attributing 10% back up to itself.
        vm.prank(payeeRoot);
        cascade.payHop(id, rootHop, payeeChild, 60e6, 1000);

        assertEq(token.balanceOf(payeeChild), 54e6, "sub-tool paid");
        assertEq(token.balanceOf(payeeRoot), 400e6 + 6e6, "attribution up");
        assertEq(cascade.allowance(id, payeeRoot), 40e6, "sub-budget drawn down");
    }

    /// @dev The whole point of capping: a hired tool cannot reach past its slice into the pool.
    function test_delegate_toolCannotSpendBeyondItsSlice() public {
        uint256 id = _open();
        vm.startPrank(buyer);
        cascade.payHop(id, 0, payeeRoot, 100e6, 0);
        cascade.delegate(id, payeeRoot, 50e6);
        vm.stopPrank();

        vm.prank(payeeRoot);
        vm.expectRevert(
            abi.encodeWithSelector(CascadeController.AllowanceExceeded.selector, id, 50e6, 51e6)
        );
        cascade.payHop(id, 0, payeeChild, 51e6, 0);
    }

    /// @dev An address with no delegated slice has no spending right at all.
    function test_payHop_outsiderHasNoAllowance() public {
        uint256 id = _open();
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(CascadeController.AllowanceExceeded.selector, id, 0, 1e6)
        );
        cascade.payHop(id, 0, outsider, 1e6, 0);
    }

    function test_delegate_subDelegatesToAnyDepth() public {
        uint256 id = _open();
        vm.startPrank(buyer);
        cascade.delegate(id, payeeRoot, 100e6);
        vm.stopPrank();

        vm.prank(payeeRoot);
        cascade.delegate(id, payeeChild, 30e6);

        assertEq(cascade.allowance(id, payeeRoot), 70e6, "parent reduced");
        assertEq(cascade.allowance(id, payeeChild), 30e6, "child granted");

        vm.prank(payeeChild);
        vm.expectRevert(
            abi.encodeWithSelector(CascadeController.AllowanceExceeded.selector, id, 30e6, 31e6)
        );
        cascade.delegate(id, outsider, 31e6);
    }

    function test_delegate_cannotExceedOwnAllowance() public {
        uint256 id = _open();
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                CascadeController.AllowanceExceeded.selector, id, BUDGET, BUDGET + 1
            )
        );
        cascade.delegate(id, payeeRoot, BUDGET + 1);
    }

    /// @dev Delegation grants a spending right, not tokens: the pool stays put until a hop pays.
    function test_delegate_doesNotMoveTokens() public {
        uint256 id = _open();
        vm.prank(buyer);
        cascade.delegate(id, payeeRoot, 500e6);

        assertEq(token.balanceOf(payeeRoot), 0, "no tokens moved");
        assertEq(token.balanceOf(address(cascade)), BUDGET, "pool intact");
        assertEq(cascade.remainingBudget(id), BUDGET, "nothing spent");
    }

    // ── expiry + liveness ────────────────────────────────────────────────────

    /// @dev Locked-funds fix: an opener that goes away used to strand the remainder forever,
    ///      because only they could close and there was no deadline.
    function test_close_isPermissionlessAfterExpiry_andAlwaysRefundsTheOpener() public {
        uint256 id = _open();
        vm.prank(buyer);
        cascade.payHop(id, 0, payeeRoot, 300e6, 0);

        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(outsider); // opener is gone; anyone may wind it down
        cascade.close(id);

        assertEq(token.balanceOf(buyer), BUDGET - 300e6, "refund went to the opener");
        assertEq(token.balanceOf(outsider), 0, "closer gains nothing");
    }

    function test_close_beforeExpiry_isOpenerOnly() public {
        uint256 id = _open();
        vm.prank(outsider);
        vm.expectRevert(CascadeController.CascadeNotExpired.selector);
        cascade.close(id);
    }

    function test_payHop_afterExpiry_reverts() public {
        uint256 id = _open();
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(buyer);
        vm.expectRevert(CascadeController.CascadeExpired.selector);
        cascade.payHop(id, 0, payeeRoot, 1e6, 0);
    }

    function test_delegate_afterExpiry_reverts() public {
        uint256 id = _open();
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(buyer);
        vm.expectRevert(CascadeController.CascadeExpired.selector);
        cascade.delegate(id, payeeRoot, 1e6);
    }

    function test_close_isTerminal() public {
        uint256 id = _open();
        vm.startPrank(buyer);
        cascade.close(id);
        vm.expectRevert(CascadeController.CascadeIsClosed.selector);
        cascade.close(id);
        vm.stopPrank();
    }

    // ── input validation ─────────────────────────────────────────────────────

    function test_openCascade_rejectsZeroDuration() public {
        vm.prank(buyer);
        vm.expectRevert(CascadeController.ZeroDuration.selector);
        cascade.openCascade(address(token), 1e6, 0);
    }

    function test_openCascade_rejectsOverlongDuration() public {
        vm.prank(buyer);
        vm.expectRevert(CascadeController.DurationTooLong.selector);
        cascade.openCascade(address(token), 1e6, 366 days);
    }

    function test_openCascade_respectsGuardedCap() public {
        vm.prank(owner);
        cascade.setMaxBudget(100e6);
        vm.prank(buyer);
        vm.expectRevert(CascadeController.ExceedsCap.selector);
        cascade.openCascade(address(token), 101e6, DURATION);
    }
}
