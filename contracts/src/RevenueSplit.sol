// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RevenueSplit
/// @notice PaymentSplitter for a single ERC-20 payment token: a server's `payTo` can
///         point here and earnings split between payees by fixed weights, pull-based
///         (PRD §5.0 C6). Modeled on OpenZeppelin's (now-removed) PaymentSplitter but
///         scoped to one ERC-20 token.
contract RevenueSplit is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public totalShares;
    uint256 public totalReleased;

    address[] public payees;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public released;

    error NoPayees();
    error LengthMismatch();
    error ZeroShares();
    error ZeroAddress();
    error DuplicatePayee(address account);
    error NoDuePayment(address account);

    event PayeeAdded(address indexed account, uint256 shares);
    event PaymentReleased(address indexed to, uint256 amount);

    constructor(
        address token_,
        address[] memory payees_,
        uint256[] memory shares_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (token_ == address(0)) revert ZeroAddress();
        if (payees_.length == 0) revert NoPayees();
        if (payees_.length != shares_.length) revert LengthMismatch();

        token = IERC20(token_);
        for (uint256 i; i < payees_.length; ++i) {
            _addPayee(payees_[i], shares_[i]);
        }
    }

    function _addPayee(address account, uint256 shares_) private {
        if (account == address(0)) revert ZeroAddress();
        if (shares_ == 0) revert ZeroShares();
        if (shares[account] != 0) revert DuplicatePayee(account);

        payees.push(account);
        shares[account] = shares_;
        totalShares += shares_;
        emit PayeeAdded(account, shares_);
    }

    /// @notice Amount currently claimable by `account`.
    function releasable(address account) public view returns (uint256) {
        uint256 totalReceived = token.balanceOf(address(this)) + totalReleased;
        return (totalReceived * shares[account]) / totalShares - released[account];
    }

    /// @notice Pull the caller's-or-anyone's due share to `account`.
    function release(address account) external {
        uint256 payment = releasable(account);
        if (payment == 0) revert NoDuePayment(account);

        released[account] += payment;
        totalReleased += payment;
        token.safeTransfer(account, payment);
        emit PaymentReleased(account, payment);
    }

    function payeeCount() external view returns (uint256) {
        return payees.length;
    }
}
