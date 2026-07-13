// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {PaymentChannel} from "../src/PaymentChannel.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PaymentChannelTest is Test {
    PaymentChannel internal channel;
    MockERC20 internal token;

    uint256 internal senderPk = 0xA11CE;
    address internal sender;
    address internal recipient = address(0xBEEF);

    uint256 internal constant DEPOSIT = 1_000e6;

    function setUp() public {
        channel = new PaymentChannel();
        token = new MockERC20("USD", "USD", 6);
        sender = vm.addr(senderPk);
        token.mint(sender, DEPOSIT);
        vm.prank(sender);
        token.approve(address(channel), DEPOSIT);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(sender);
        id = channel.open(recipient, address(token), DEPOSIT, 1 days);
    }

    function _sign(uint256 id, uint256 cumulative) internal view returns (bytes memory) {
        bytes32 digest =
            MessageHashUtils.toEthSignedMessageHash(channel.voucherHash(id, cumulative));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(senderPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_redeem_happyPath_monotonic() public {
        uint256 id = _open();

        // First voucher: cumulative 300.
        channel.redeem(id, 300e6, _sign(id, 300e6));
        assertEq(token.balanceOf(recipient), 300e6, "first payout");

        // Second voucher: cumulative 500 -> incremental 200.
        channel.redeem(id, 500e6, _sign(id, 500e6));
        assertEq(token.balanceOf(recipient), 500e6, "second payout");
    }

    function test_redeem_rejectsNonMonotonic() public {
        uint256 id = _open();
        channel.redeem(id, 500e6, _sign(id, 500e6));
        // Sign first: expectRevert applies to the next external call, and _sign itself
        // calls channel.voucherHash(), so precompute the signature.
        bytes memory sig = _sign(id, 400e6);
        vm.expectRevert(PaymentChannel.NonMonotonic.selector);
        channel.redeem(id, 400e6, sig);
    }

    function test_reclaim_afterExpiry_returnsRemainder() public {
        uint256 id = _open();
        channel.redeem(id, 200e6, _sign(id, 200e6));

        vm.warp(block.timestamp + 2 days);
        vm.prank(sender);
        channel.reclaim(id);
        assertEq(token.balanceOf(sender), DEPOSIT - 200e6, "reclaimed remainder");
    }

    function test_redeem_badSignatureReverts() public {
        uint256 id = _open();
        // Sign with a different key.
        bytes32 digest =
            MessageHashUtils.toEthSignedMessageHash(channel.voucherHash(id, 100e6));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADD, digest);
        vm.expectRevert(PaymentChannel.BadSignature.selector);
        channel.redeem(id, 100e6, abi.encodePacked(r, s, v));
    }
}
