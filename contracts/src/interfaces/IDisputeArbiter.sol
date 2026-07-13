// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IDisputeArbiter
/// @notice Pluggable arbitration surface. The default implementation records rulings
///         on-chain and drives bond slashing / escrow refunds; a BitVM2 fraud-proof
///         arbiter is the trust-minimized upgrade path (see DisputeArbiter.sol).
interface IDisputeArbiter {
    event DisputeOpened(
        uint256 indexed disputeId,
        bytes32 indexed subject,
        address indexed buyer,
        address seller,
        bytes32 toolId
    );
    event DisputeRuled(uint256 indexed disputeId, bool forBuyer);

    /// @notice Open a dispute over a settled receipt / hop.
    /// @param subject      Identifier of the disputed item (e.g. a receiptId).
    /// @param buyer        Party requesting recourse.
    /// @param seller       Party being disputed.
    /// @param toolId       Tool whose bond may be slashed.
    /// @param escrowId     Escrow to refund on a buyer-favorable ruling (0 if none).
    /// @param slashAmount  Bond amount to slash on a buyer-favorable ruling (0 if none).
    function openDispute(
        bytes32 subject,
        address buyer,
        address seller,
        bytes32 toolId,
        uint256 escrowId,
        uint256 slashAmount
    ) external returns (uint256 disputeId);

    /// @notice Rule on a dispute; `forBuyer` true triggers refund/slash.
    function rule(uint256 disputeId, bool forBuyer) external;
}
