// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title PaymentChannel
/// @notice Prepaid, unidirectional payment channels for high-frequency agent traffic
///         (PRD §5.0 C7). The sender deposits once, then authorizes usage off-chain with
///         signed, *monotonically increasing* cumulative-amount vouchers. The recipient
///         redeems the latest voucher on-chain; the sender can reclaim the unspent balance
///         after the channel expires.
contract PaymentChannel is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

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
    error ChannelIsClosed();
    error NotSender();
    error NotParty();
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

    /// @notice Open a channel, pulling `deposit` from the caller (the sender).
    function open(address recipient, address token, uint256 deposit, uint256 duration)
        external
        nonReentrant
        returns (uint256 channelId)
    {
        if (deposit == 0) revert ZeroDeposit();
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

    /// @notice The message a sender signs to authorize a cumulative payout.
    function voucherHash(uint256 channelId, uint256 cumulativeAmount)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(address(this), channelId, cumulativeAmount));
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

        bytes32 digest = voucherHash(channelId, cumulativeAmount).toEthSignedMessageHash();
        if (digest.recover(signature) != ch.sender) revert BadSignature();

        uint256 payout = cumulativeAmount - ch.claimed;
        ch.claimed = cumulativeAmount;
        ch.token.safeTransfer(ch.recipient, payout);
        emit Redeemed(channelId, cumulativeAmount, payout);
    }

    /// @notice Cooperatively close: either party settles and the sender gets the remainder.
    function close(uint256 channelId) external nonReentrant {
        Channel storage ch = channels[channelId];
        if (!ch.open) revert ChannelIsClosed();
        if (msg.sender != ch.sender && msg.sender != ch.recipient) revert NotParty();

        ch.open = false;
        uint256 remainder = ch.deposit - ch.claimed;
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
