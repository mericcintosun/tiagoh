// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC3009 — Transfer With Authorization
/// @notice The x402 payment token on GOAT settles via ERC-3009
///         (`transferWithAuthorization` / `receiveWithAuthorization`), letting the
///         facilitator submit a payer-signed authorization so the buyer agent never
///         needs native gas. tiagoh contracts reference this interface when a payment
///         token is settled by the facilitator.
interface IERC3009 {
    /// @notice Emitted when an authorization nonce is consumed.
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    /// @notice Emitted when an authorization is canceled before use.
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    /// @notice Execute a transfer with a signed authorization.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice Receive a transfer with a signed authorization (payee-submitted).
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice Cancel an unused authorization.
    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)
        external;

    /// @notice True once `nonce` for `authorizer` has been used or canceled.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
