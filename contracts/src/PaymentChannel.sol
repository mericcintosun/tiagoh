// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title PaymentChannel
/// @notice Prepaid, unidirectional payment channels for high-frequency agent traffic
///         (PRD §5.0 C7). The sender deposits once, then authorizes usage off-chain with
///         signed, *monotonically increasing* cumulative-amount vouchers. The recipient
///         redeems the latest voucher on-chain; the sender can reclaim the unspent balance
///         after the channel expires.
/// @dev    Vouchers are EIP-712 typed signatures: the domain binds chainId + this contract,
///         so a voucher can never replay on another chain or another deployment.
contract PaymentChannel is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(uint256 channelId,uint256 cumulativeAmount)");
    bytes32 public constant CLOSE_TYPEHASH =
        keccak256("Close(uint256 channelId,uint256 cumulativeAmount)");

    struct Channel {
        address sender; // funder & voucher signer
        address recipient;
        IERC20 token;
        uint256 deposit;
        uint256 claimed; // cumulative amount already redeemed (monotonic)
        uint256 expiration;
        bool open;
    }

    uint256 public channelCount;
    mapping(uint256 => Channel) public channels;

    error ZeroDeposit();
    error ZeroRecipient();
    error ChannelIsClosed();
    error NotSender();
    error NotRecipient();
    error BadSignature();
    error NonMonotonic();
    error ExceedsDeposit();
    error NotExpired();

    event ChannelOpened(
        uint256 indexed channelId,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 deposit,
        uint256 expiration
    );
    event Redeemed(uint256 indexed channelId, uint256 cumulativeAmount, uint256 paidOut);
    event Reclaimed(uint256 indexed channelId, uint256 amount);
    event ChannelClosed(uint256 indexed channelId, uint256 remainderToSender);

    constructor() EIP712("tiagoh PaymentChannel", "1") {}

    /// @notice Open a channel, pulling `deposit` from the caller (the sender).
    function open(address recipient, address token, uint256 deposit, uint256 duration)
        external
        nonReentrant
        returns (uint256 channelId)
    {
        if (deposit == 0) revert ZeroDeposit();
        if (recipient == address(0)) revert ZeroRecipient();
        uint256 exp = block.timestamp + duration;
        channelId = ++channelCount;
        channels[channelId] = Channel({
            sender: msg.sender,
            recipient: recipient,
            token: IERC20(token),
            deposit: deposit,
            claimed: 0,
            expiration: exp,
            open: true
        });
        IERC20(token).safeTransferFrom(msg.sender, address(this), deposit);
        emit ChannelOpened(channelId, msg.sender, recipient, token, deposit, exp);
    }

    /// @notice The EIP-712 digest a sender signs to authorize a cumulative payout.
    function voucherHash(uint256 channelId, uint256 cumulativeAmount)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(VOUCHER_TYPEHASH, channelId, cumulativeAmount))
        );
    }

    /// @notice Redeem a signed voucher, paying the recipient the incremental amount.
    function redeem(uint256 channelId, uint256 cumulativeAmount, bytes calldata signature)
        external
        nonReentrant
    {
        Channel storage ch = channels[channelId];
        if (!ch.open) revert ChannelIsClosed();
        if (cumulativeAmount <= ch.claimed) revert NonMonotonic();
        if (cumulativeAmount > ch.deposit) revert ExceedsDeposit();

        bytes32 digest = voucherHash(channelId, cumulativeAmount);
        if (digest.recover(signature) != ch.sender) revert BadSignature();

        uint256 payout = cumulativeAmount - ch.claimed;
        ch.claimed = cumulativeAmount;
        ch.token.safeTransfer(ch.recipient, payout);
        emit Redeemed(channelId, cumulativeAmount, payout);
    }

    /// @notice Recipient-only early close: the payee ends the channel and the unspent remainder
    ///         returns to the sender. Restricted to the recipient because a sender-initiated
    ///         early close could front-run the recipient's pending `redeem` and strip funds the
    ///         recipient already earned. The sender's non-cooperative exit is `reclaim` (after
    ///         expiration) or `cooperativeClose` (with the recipient's signed final amount).
    function close(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (!ch.open) revert ChannelIsClosed();
        if (msg.sender != ch.recipient) revert NotRecipient();

        ch.open = false;
        uint256 remainder = ch.deposit - ch.claimed;
        if (remainder > 0) {
            ch.token.safeTransfer(ch.sender, remainder);
        }
        emit ChannelClosed(channelId, remainder);
    }

    /// @notice The EIP-712 digest a recipient signs to authorize a cooperative early close at a
    ///         final cumulative amount (distinct from a voucher, so an interim voucher can never
    ///         be repurposed by the sender to close the channel early).
    function closeHash(uint256 channelId, uint256 cumulativeAmount) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(CLOSE_TYPEHASH, channelId, cumulativeAmount))
        );
    }

    /// @notice Cooperative early close submitted by the sender: pays the recipient the final
    ///         cumulative amount they signed off on, returns the rest to the sender, and closes.
    ///         The recipient's signature guarantees they are made whole for the settled amount,
    ///         so the sender cannot short-change them.
    function cooperativeClose(uint256 channelId, uint256 cumulativeAmount, bytes calldata recipientSig)
        external
        nonReentrant
    {
        Channel storage ch = channels[channelId];
        if (!ch.open) revert ChannelIsClosed();
        if (msg.sender != ch.sender) revert NotSender();
        if (cumulativeAmount < ch.claimed) revert NonMonotonic();
        if (cumulativeAmount > ch.deposit) revert ExceedsDeposit();

        bytes32 digest = closeHash(channelId, cumulativeAmount);
        if (digest.recover(recipientSig) != ch.recipient) revert BadSignature();

        ch.open = false;
        uint256 pay = cumulativeAmount - ch.claimed;
        ch.claimed = cumulativeAmount;
        uint256 remainder = ch.deposit - cumulativeAmount;
        if (pay > 0) {
            ch.token.safeTransfer(ch.recipient, pay);
        }
        if (remainder > 0) {
            ch.token.safeTransfer(ch.sender, remainder);
        }
        emit ChannelClosed(channelId, remainder);
    }

    /// @notice Sender reclaims the unspent balance after expiration.
    function reclaim(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (!ch.open) revert ChannelIsClosed();
        if (msg.sender != ch.sender) revert NotSender();
        if (block.timestamp < ch.expiration) revert NotExpired();

        ch.open = false;
        uint256 remainder = ch.deposit - ch.claimed;
        if (remainder > 0) {
            ch.token.safeTransfer(ch.sender, remainder);
        }
        emit Reclaimed(channelId, remainder);
    }
}
