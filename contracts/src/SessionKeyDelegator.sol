// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title SessionKeyDelegator
/// @notice Scoped, signature-gated spend delegation: the on-chain enforcement point for capped
///         agent-to-agent sub-budgets (PRD 5.3), and the piece an ERC-4337 account's validation
///         hook calls before executing a UserOp. A parent grants a session key a spend cap and an
///         expiry. Every spend must carry the session key's signature over (this, parent, amount,
///         nonce), is nonce-protected against replay, and reverts past the cap. Keys revoke instantly.
contract SessionKeyDelegator {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct Session {
        uint256 cap;
        uint256 spent;
        uint64 expiry; // 0 = no expiry
        bool active;
    }

    /// @dev parent => sessionKey => Session
    mapping(address => mapping(address => Session)) public sessions;
    /// @dev parent => sessionKey => next expected nonce (replay protection)
    mapping(address => mapping(address => uint256)) public nonces;

    error NotActive();
    error Expired();
    error CapExceeded(uint256 remaining, uint256 requested);
    error BadSignature();
    error BadNonce();

    event SessionGranted(address indexed parent, address indexed sessionKey, uint256 cap, uint64 expiry);
    event SessionRevoked(address indexed parent, address indexed sessionKey);
    event Spent(address indexed parent, address indexed sessionKey, uint256 amount, uint256 totalSpent);

    /// @notice Grant or replace a session key's spend cap and expiry (parent = caller).
    function grant(address sessionKey, uint256 cap, uint64 expiry) external {
        Session storage s = sessions[msg.sender][sessionKey];
        s.cap = cap;
        s.expiry = expiry;
        s.active = true;
        emit SessionGranted(msg.sender, sessionKey, cap, expiry);
    }

    /// @notice Revoke a session key immediately.
    function revoke(address sessionKey) external {
        sessions[msg.sender][sessionKey].active = false;
        emit SessionRevoked(msg.sender, sessionKey);
    }

    /// @notice Remaining spendable allowance for a session key.
    function remaining(address parent, address sessionKey) external view returns (uint256) {
        Session storage s = sessions[parent][sessionKey];
        return s.cap > s.spent ? s.cap - s.spent : 0;
    }

    /// @notice The message a session key signs to authorize a spend.
    function spendHash(address parent, uint256 amount, uint256 nonce) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), parent, amount, nonce));
    }

    /// @notice Record a spend authorized by the session key's signature; reverts past cap/expiry.
    ///         The session key is recovered from the signature, so a relayer can submit it.
    function spend(address parent, uint256 amount, uint256 nonce, bytes calldata signature)
        external
        returns (address sessionKey)
    {
        bytes32 digest = spendHash(parent, amount, nonce).toEthSignedMessageHash();
        sessionKey = digest.recover(signature);
        if (sessionKey == address(0)) revert BadSignature();

        Session storage s = sessions[parent][sessionKey];
        if (!s.active) revert NotActive();
        if (s.expiry != 0 && block.timestamp > s.expiry) revert Expired();
        if (nonce != nonces[parent][sessionKey]) revert BadNonce();

        uint256 rem = s.cap > s.spent ? s.cap - s.spent : 0;
        if (amount > rem) revert CapExceeded(rem, amount);

        s.spent += amount;
        nonces[parent][sessionKey] = nonce + 1;
        emit Spent(parent, sessionKey, amount, s.spent);
    }
}
