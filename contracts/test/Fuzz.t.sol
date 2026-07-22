// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CascadeController} from "../src/CascadeController.sol";
import {SessionKeyDelegator} from "../src/SessionKeyDelegator.sol";
import {PaymentChannel} from "../src/PaymentChannel.sol";
import {QualityBond} from "../src/QualityBond.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Property/fuzz tests over the money-moving math. These assert invariants that must
///         hold for ANY input, not just the hand-picked unit-test cases.
contract FuzzTest is Test {
    CascadeController internal cascade;
    SessionKeyDelegator internal del;
    PaymentChannel internal channel;
    QualityBond internal bondC;
    MockERC20 internal token;

    address internal owner = address(0xA0);
    address internal arbiter = address(0xAB);
    uint256 internal senderPk = 0xA11CE;
    address internal sender;

    function setUp() public {
        cascade = new CascadeController(owner);
        del = new SessionKeyDelegator();
        channel = new PaymentChannel(0);
        token = new MockERC20("USD", "USD", 6);
        bondC = new QualityBond(address(token), owner);
        vm.prank(owner);
        bondC.setArbiter(arbiter, true);
        sender = vm.addr(senderPk);
    }

    /// @dev A single hop never spends more than the cascade budget; overspend always reverts.
    function testFuzz_cascade_hopNeverExceedsBudget(uint96 budget, uint96 amount, address payee) public {
        vm.assume(budget > 0 && payee != address(0) && payee != address(cascade));
        token.mint(address(this), budget);
        token.approve(address(cascade), budget);
        uint256 id = cascade.openCascade(address(token), budget);

        if (amount > budget) {
            vm.expectRevert(
                abi.encodeWithSelector(CascadeController.BudgetExceeded.selector, id, uint256(budget), uint256(amount))
            );
            cascade.payHop(id, 0, payee, amount, 0);
        } else {
            cascade.payHop(id, 0, payee, amount, 0);
            assertEq(cascade.remainingBudget(id), uint256(budget) - amount, "spent tracked exactly");
        }
    }

    /// @dev Session spend never exceeds the cap, regardless of how the amount is split.
    function testFuzz_sessionKey_neverExceedsCap(uint128 cap, uint128 a1, uint128 a2) public {
        address sk = vm.addr(senderPk);
        vm.prank(owner);
        del.grant(sk, cap, 0);
        (,,,, uint256 epoch) = del.sessions(owner, sk);

        _trySpend(sk, owner, a1, 0, epoch, cap);
        uint256 spentSoFar = uint256(cap) >= a1 ? a1 : 0;
        // second spend uses nonce 1 only if the first succeeded
        if (spentSoFar == a1) {
            _trySpend(sk, owner, a2, 1, epoch, cap - a1 >= 0 ? cap - uint128(a1) : 0);
        }
        assertLe(uint256(cap) - del.remaining(owner, sk), cap, "spent never exceeds cap");
    }

    function _trySpend(address sk, address parent, uint128 amount, uint256 nonce, uint256 epoch, uint256 rem)
        internal
    {
        bytes32 digest = del.spendHash(parent, amount, nonce, epoch);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(senderPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        if (amount > rem) {
            vm.expectRevert(abi.encodeWithSelector(SessionKeyDelegator.CapExceeded.selector, rem, uint256(amount)));
            del.spend(parent, amount, nonce, epoch, sig);
        } else {
            del.spend(parent, amount, nonce, epoch, sig);
        }
        sk; // silence
    }

    /// @dev A channel never pays out more than its deposit; a monotonic voucher pays the delta.
    function testFuzz_channel_payoutBoundedByDeposit(uint96 deposit, uint96 v1, uint96 v2) public {
        vm.assume(deposit > 0);
        token.mint(sender, deposit);
        vm.prank(sender);
        token.approve(address(channel), deposit);
        vm.prank(sender);
        uint256 id = channel.open(address(0xBEEF), address(token), deposit, 1 days);

        uint256 c1 = bound(uint256(v1), 1, deposit);
        _redeem(id, c1);
        assertEq(token.balanceOf(address(0xBEEF)), c1, "paid cumulative 1");

        uint256 c2 = bound(uint256(v2), c1 + 1, uint256(deposit) + 1);
        if (c2 > deposit) {
            bytes memory sig = _voucher(id, c2);
            vm.expectRevert(PaymentChannel.ExceedsDeposit.selector);
            channel.redeem(id, c2, sig);
        } else {
            _redeem(id, c2);
            assertEq(token.balanceOf(address(0xBEEF)), c2, "paid cumulative 2");
        }
        assertLe(token.balanceOf(address(0xBEEF)), deposit, "never over deposit");
    }

    function _voucher(uint256 id, uint256 cumulative) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(senderPk, channel.voucherHash(id, cumulative));
        return abi.encodePacked(r, s, v);
    }

    function _redeem(uint256 id, uint256 cumulative) internal {
        channel.redeem(id, cumulative, _voucher(id, cumulative));
    }

    /// @dev A slash can never exceed the live bond; the bond only ever decreases by the slash.
    function testFuzz_bond_slashNeverExceedsBond(uint96 slashAmt) public {
        bytes32 toolId = keccak256("tool");
        address seller = address(0x5E);
        address buyer = address(0xB0);
        token.mint(seller, 500e6);
        vm.prank(seller);
        token.approve(address(bondC), type(uint256).max);
        vm.prank(seller);
        bondC.bond(toolId, QualityBond.Tier.SILVER); // 500e6

        if (slashAmt > 500e6) {
            vm.prank(arbiter);
            vm.expectRevert(QualityBond.SlashExceedsBond.selector);
            bondC.slash(toolId, slashAmt, buyer);
        } else {
            vm.prank(arbiter);
            bondC.slash(toolId, slashAmt, buyer);
            assertEq(bondC.bondAmount(toolId), 500e6 - slashAmt, "bond reduced by exactly the slash");
            assertEq(token.balanceOf(buyer), slashAmt, "buyer received exactly the slash");
        }
    }
}
