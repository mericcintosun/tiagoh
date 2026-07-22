// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IFeedbackAuthorizer} from "./interfaces/IFeedbackAuthorizer.sol";

/// @title FeedbackAllowlist
/// @notice Reference `IFeedbackAuthorizer`: an owner-curated allowlist of writers permitted
///         to post ERC-8004 feedback. tiagoh's gateway (which only writes feedback derived
///         from real settled receipts and adjudicated disputes) is added here; everyone else
///         is rejected. This is the pragmatic Sybil filter for a tiagoh-operated reputation
///         registry — the raw ERC-8004 registry stays permissionless by default, and only a
///         registry deployed with this authorizer is gated.
/// @dev    Swap for a receipt-gated authorizer (one that verifies `feedbackHash` against a
///         ReceiptRegistry entry whose payer == client and payee == subject) for a fully
///         trust-minimized variant; both satisfy the same interface.
contract FeedbackAllowlist is Ownable2Step, IFeedbackAuthorizer {
    mapping(address => bool) public allowed;

    event WriterSet(address indexed writer, bool allowed);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setWriter(address writer, bool allowed_) external onlyOwner {
        allowed[writer] = allowed_;
        emit WriterSet(writer, allowed_);
    }

    /// @inheritdoc IFeedbackAuthorizer
    function canGiveFeedback(address client, uint256, address, int128, bytes32)
        external
        view
        returns (bool)
    {
        return allowed[client];
    }
}
