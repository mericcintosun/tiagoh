// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title SessionKeyDelegator
/// @notice Scoped, signature-gated spend delegation: the on-chain enforcement point for capped
///         agent-to-agent sub-budgets (PRD 5.3), and the piece an ERC-4337 account's validation
///         hook calls before executing a UserOp. A parent grants a session key a spend cap and an
///         expiry. Every spend must carry the session key's EIP-712 signature over (parent,
///         amount, nonce), is nonce-protected against replay, and reverts past the cap. Keys
///         revoke instantly.
/// @dev    Spends are EIP-712 typed signatures: the domain binds chainId + this contract, so a
///         spend authorization can never replay on another chain or another deployment. Each
///         signature also binds an `epoch`; `grant` and `revoke` both bump the epoch, so a
///         `revoke` durably kills every pre-signed-but-unsubmitted spend — even one signed for
///         an unused nonce — and a later re-grant (fresh cap, `spent` reset) cannot resurrect it.
contract SessionKeyDelegator is EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant SPEND_TYPEHASH =
        keccak256("Spend(address parent,uint256 amount,uint256 nonce,uint256 epoch)");

    struct Session {
        uint256 cap;
        uint256 spent;
        uint64 expiry; // 0 = no expiry
        bool active;
        uint256 epoch; // bumped on every grant/revoke; bound into each spend signature
    }

    /// @dev parent => sessionKey => Session
    mapping(address => mapping(address => Session)) public sessions;
    /// @dev parent => sessionKey => next expected nonce (replay protection; never reset)
    mapping(address => mapping(address => uint256)) public nonces;

    error NotActive();
    error Expired();
    error BadExpiry();
    error CapExceeded(uint256 remaining, uint256 requested);
    error BadSignature();
    error BadNonce();
    error BadEpoch();

    event SessionGranted(
        address indexed parent, address indexed sessionKey, uint256 cap, uint64 expiry, uint256 epoch
    );
    event SessionRevoked(address indexed parent, address indexed sessionKey, uint256 epoch);
    event Spent(address indexed parent, address indexed sessionKey, uint256 amount, uint256 totalSpent);

    constructor() EIP712("tiagoh SessionKeyDelegator", "1") {}

    /// @notice Grant or replace a session key's spend cap and expiry (parent = caller).
    ///         A grant is a fresh allowance: prior `spent` is cleared and the epoch is bumped,
    ///         so any spend signed under a previous grant (submitted or not) is permanently dead.
    function grant(address sessionKey, uint256 cap, uint64 expiry) external {
        if (expiry != 0 && expiry <= block.timestamp) revert BadExpiry();
        Session storage s = sessions[msg.sender][sessionKey];
        s.cap = cap;
        s.spent = 0;
        s.expiry = expiry;
        s.active = true;
        s.epoch += 1;
        emit SessionGranted(msg.sender, sessionKey, cap, expiry, s.epoch);
    }

    /// @notice Revoke a session key immediately. Bumping the epoch invalidates every spend that
    ///         was signed but not yet submitted, so revoke is durable even if the key is re-granted.
    function revoke(address sessionKey) external {
        Session storage s = sessions[msg.sender][sessionKey];
        s.active = false;
        s.epoch += 1;
        emit SessionRevoked(msg.sender, sessionKey, s.epoch);
    }

    /// @notice Remaining spendable allowance for a session key.
    function remaining(address parent, address sessionKey) external view returns (uint256) {
        Session storage s = sessions[parent][sessionKey];
        return s.cap > s.spent ? s.cap - s.spent : 0;
    }

    /// @notice The EIP-712 digest a session key signs to authorize a spend. `epoch` must equal
    ///         the session's current epoch (read `sessions(parent, key).epoch`).
    function spendHash(address parent, uint256 amount, uint256 nonce, uint256 epoch)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(SPEND_TYPEHASH, parent, amount, nonce, epoch)));
    }

    /// @notice Record a spend authorized by the session key's signature; reverts past cap/expiry,
    ///         on a stale epoch (post-revoke/re-grant), or a bad nonce. The session key is
    ///         recovered from the signature, so a relayer can submit it.
    function spend(address parent, uint256 amount, uint256 nonce, uint256 epoch, bytes calldata signature)
        external
        returns (address sessionKey)
    {
        bytes32 digest = spendHash(parent, amount, nonce, epoch);
        sessionKey = digest.recover(signature);

        Session storage s = sessions[parent][sessionKey];
        if (!s.active) revert NotActive();
        if (epoch != s.epoch) revert BadEpoch();
        if (s.expiry != 0 && block.timestamp > s.expiry) revert Expired();
        if (nonce != nonces[parent][sessionKey]) revert BadNonce();

        uint256 rem = s.cap > s.spent ? s.cap - s.spent : 0;
        if (amount > rem) revert CapExceeded(rem, amount);

        s.spent += amount;
        nonces[parent][sessionKey] = nonce + 1;
        emit Spent(parent, sessionKey, amount, s.spent);
    }
}
