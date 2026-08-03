// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IDisputeArbiter
/// @notice Pluggable arbitration surface. The default implementation records rulings
///         on-chain and drives bond slashing / escrow refunds; a BitVM2 fraud-proof
///         arbiter is the trust-minimized upgrade path (see DisputeArbiter.sol).
///
/// @dev    The buyer, the seller and the tool are all DERIVED from the harm the dispute
///         points at (a co-signed receipt and/or a held escrow) rather than passed in by the
///         caller. Deriving them removes an entire class of mismatch bugs: a dispute can only
///         ever name the parties that the on-chain evidence already names.
interface IDisputeArbiter {
    event DisputeOpened(
        uint256 indexed disputeId,
        bytes32 indexed subject,
        address indexed buyer,
        address seller,
        bytes32 toolId
    );
    event DisputeRuled(uint256 indexed disputeId, bool forBuyer);
    event DisputeExpired(uint256 indexed disputeId);

    /// @notice Open a dispute over harm proven on-chain. The caller is the buyer.
    /// @param receiptId    A co-signed receipt naming the caller as payer (0 if escrow-only).
    /// @param escrowId     A held escrow the caller funded (0 if receipt-only).
    /// @param slashAmount  Bond amount to slash on a buyer-favorable ruling (0 for none),
    ///                     capped to both the proven harm and the tool's live bond.
    function openDispute(bytes32 receiptId, uint256 escrowId, uint256 slashAmount)
        external
        returns (uint256 disputeId);

    /// @notice Rule on a dispute; `forBuyer` true triggers refund/slash.
    function rule(uint256 disputeId, bool forBuyer) external;
}
