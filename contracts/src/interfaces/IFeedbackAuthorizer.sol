// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFeedbackAuthorizer
/// @notice Optional gate for ERC8004ReputationRegistry.giveFeedback. When a registry is
///         constructed with a non-zero authorizer, every feedback write must be approved
///         here first, which turns the otherwise-permissionless (Sybil-able) registry into
///         a receipt-gated / allowlisted one without changing the canonical `giveFeedback`
///         signature. A zero authorizer keeps the ERC-8004 default: fully permissionless.
interface IFeedbackAuthorizer {
    /// @param client       msg.sender attempting to write feedback.
    /// @param agentId      the agent the feedback is about.
    /// @param subject      the agent's subject address (tool/agent being rated).
    /// @param value        the feedback value (positive = success, negative = dispute/slash).
    /// @param feedbackHash the anchoring hash (e.g. keccak256(receiptId)); an implementation
    ///                     may require this to correspond to a real settled receipt.
    /// @return allowed     true if the write may proceed.
    function canGiveFeedback(
        address client,
        uint256 agentId,
        address subject,
        int128 value,
        bytes32 feedbackHash
    ) external view returns (bool allowed);
}
