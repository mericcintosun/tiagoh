// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
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
        channel = new PaymentChannel(0); // 0 = uncapped in tests
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

    /// @dev Vouchers are EIP-712 typed digests (chainId + contract bound).
    function _sign(uint256 id, uint256 cumulative) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(senderPk, channel.voucherHash(id, cumulative));
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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADD, channel.voucherHash(id, 100e6));
        vm.expectRevert(PaymentChannel.BadSignature.selector);
        channel.redeem(id, 100e6, abi.encodePacked(r, s, v));
    }

    /// @dev F3 fix: the sender can no longer unilaterally `close()` and strip the recipient's
    ///      unredeemed vouchers. Only the recipient may close early.
    function test_close_senderCannotClose() public {
        uint256 id = _open();
        vm.prank(sender);
        vm.expectRevert(PaymentChannel.NotRecipient.selector);
        channel.close(id);
    }

    function test_close_recipientCloses_remainderToSender() public {
        uint256 id = _open();
        channel.redeem(id, 200e6, _sign(id, 200e6));
        vm.prank(recipient);
        channel.close(id);
        assertEq(token.balanceOf(sender), DEPOSIT - 200e6, "remainder back to sender");
        assertEq(token.balanceOf(recipient), 200e6, "recipient keeps earned");
    }

    /// @dev The sender's early exit requires the recipient's signed final amount, so the
    ///      recipient is always made whole for what they earned.
    function test_cooperativeClose_paysRecipientThenSender() public {
        uint256 id = _open();
        // Recipient signs a Close authorization for cumulative 300 (distinct from a voucher).
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(senderPk, channel.closeHash(id, 300e6));
        // Wrong signer: closeHash must be signed by the RECIPIENT. Here sender != recipient.
        bytes memory badSig = abi.encodePacked(r, s, v);
        vm.prank(sender);
        vm.expectRevert(PaymentChannel.BadSignature.selector);
        channel.cooperativeClose(id, 300e6, badSig);
    }

    function test_cooperativeClose_withRecipientSig() public {
        // Recompute with a recipient whose key we control.
        uint256 recipPk = 0xC0FFEE;
        address recip = vm.addr(recipPk);
        vm.prank(sender);
        uint256 id = channel.open(recip, address(token), DEPOSIT, 1 days);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(recipPk, channel.closeHash(id, 400e6));
        vm.prank(sender);
        channel.cooperativeClose(id, 400e6, abi.encodePacked(r, s, v));

        assertEq(token.balanceOf(recip), 400e6, "recipient paid final amount");
        assertEq(token.balanceOf(sender), DEPOSIT - 400e6, "sender gets remainder");
    }
}
