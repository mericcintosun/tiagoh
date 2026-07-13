// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IDisputeArbiter} from "./interfaces/IDisputeArbiter.sol";

interface IQualityBondSlasher {
    function slash(bytes32 toolId, uint256 amount, address to) external;
}

interface IEscrowRefunder {
    function refund(uint256 escrowId) external;
}

/// @notice Minimal surface of a GOAT BitVM2 fraud-proof verifier. The real challenge-response
///         game runs in GOAT's BitVM2 node; this contract calls into it to adjudicate a challenge.
interface IBitVM2Verifier {
    /// @return fraudProven true if the challenged (optimistic) ruling was shown to be fraudulent.
    function verifyChallenge(bytes32 subject, bytes calldata proof) external returns (bool fraudProven);
}

/// @title BitVM2Arbiter
/// @notice The trust-minimized `IDisputeArbiter`: rulings are OPTIMISTIC. A proposed ruling
///         finalizes after a challenge window unless someone challenges it; a challenge escalates
///         to a BitVM2 fraud-proof verifier, whose verdict decides the outcome (flipping the
///         ruling if fraud is proven). This is a drop-in swap for the permissioned DisputeArbiter:
///         same interface, so QualityBond / EscrowVault recourse is untouched. GOAT built BitVM2
///         for sequencer honesty; tiagoh reuses that challenge substrate to adjudicate commercial
///         disputes with Bitcoin-anchored enforcement instead of a trusted juror.
contract BitVM2Arbiter is Ownable, IDisputeArbiter {
    enum Status {
        NONE,
        OPEN,
        PROPOSED,
        RULED
    }

    struct Dispute {
        bytes32 subject;
        address buyer;
        address seller;
        bytes32 toolId;
        uint256 escrowId;
        uint256 slashAmount;
        bool proposedForBuyer;
        uint64 proposedAt;
        Status status;
        bool forBuyer;
    }

    uint256 public disputeCount;
    mapping(uint256 => Dispute) public disputes;
    uint256 public challengeWindow = 1 hours;

    IQualityBondSlasher public qualityBond;
    IEscrowRefunder public escrowVault;
    IBitVM2Verifier public verifier;

    error NotOpen();
    error NotProposed();
    error WindowNotElapsed();
    error WindowElapsed();
    error NoVerifier();
    error ZeroParty();

    event RulingProposed(uint256 indexed disputeId, bool forBuyer, uint64 finalizeAt);
    event Challenged(uint256 indexed disputeId, address indexed challenger, bool fraudProven);
    event RecourseExecuted(uint256 indexed disputeId, uint256 escrowId, bytes32 toolId, uint256 slashed);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setRecourseTargets(address qualityBond_, address escrowVault_) external onlyOwner {
        qualityBond = IQualityBondSlasher(qualityBond_);
        escrowVault = IEscrowRefunder(escrowVault_);
    }

    function setVerifier(address verifier_) external onlyOwner {
        verifier = IBitVM2Verifier(verifier_);
    }

    function setChallengeWindow(uint256 window) external onlyOwner {
        challengeWindow = window;
    }

    /// @inheritdoc IDisputeArbiter
    function openDispute(
        bytes32 subject,
        address buyer,
        address seller,
        bytes32 toolId,
        uint256 escrowId,
        uint256 slashAmount
    ) external returns (uint256 disputeId) {
        if (buyer == address(0) || seller == address(0)) revert ZeroParty();
        disputeId = ++disputeCount;
        Dispute storage d = disputes[disputeId];
        d.subject = subject;
        d.buyer = buyer;
        d.seller = seller;
        d.toolId = toolId;
        d.escrowId = escrowId;
        d.slashAmount = slashAmount;
        d.status = Status.OPEN;
        emit DisputeOpened(disputeId, subject, buyer, seller, toolId);
    }

    /// @notice Propose an optimistic ruling. Anyone may propose; it finalizes after the window
    ///         unless challenged.
    function propose(uint256 disputeId, bool forBuyer) external {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.OPEN) revert NotOpen();
        d.proposedForBuyer = forBuyer;
        d.proposedAt = uint64(block.timestamp);
        d.status = Status.PROPOSED;
        emit RulingProposed(disputeId, forBuyer, uint64(block.timestamp + challengeWindow));
    }

    /// @notice Challenge a proposed ruling within the window; escalates to the BitVM2 verifier.
    ///         If fraud is proven, the proposed ruling is flipped before finalizing.
    function challenge(uint256 disputeId, bytes calldata proof) external {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.PROPOSED) revert NotProposed();
        if (block.timestamp > d.proposedAt + challengeWindow) revert WindowElapsed();
        if (address(verifier) == address(0)) revert NoVerifier();

        bool fraud = verifier.verifyChallenge(d.subject, proof);
        emit Challenged(disputeId, msg.sender, fraud);
        _finalize(disputeId, d, fraud ? !d.proposedForBuyer : d.proposedForBuyer);
    }

    /// @inheritdoc IDisputeArbiter
    /// @notice Finalize an unchallenged proposal after the window. The optimistic ruling stands;
    ///         `forBuyer` must match the proposal (it is advisory, kept for interface parity).
    function rule(uint256 disputeId, bool forBuyer) external {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.PROPOSED) revert NotProposed();
        if (block.timestamp <= d.proposedAt + challengeWindow) revert WindowNotElapsed();
        forBuyer; // silence unused; the proposal is authoritative
        _finalize(disputeId, d, d.proposedForBuyer);
    }

    function _finalize(uint256 disputeId, Dispute storage d, bool forBuyer) internal {
        d.status = Status.RULED;
        d.forBuyer = forBuyer;

        uint256 slashed;
        if (forBuyer) {
            if (address(escrowVault) != address(0) && d.escrowId != 0) {
                escrowVault.refund(d.escrowId);
            }
            if (address(qualityBond) != address(0) && d.slashAmount != 0) {
                qualityBond.slash(d.toolId, d.slashAmount, d.buyer);
                slashed = d.slashAmount;
            }
            emit RecourseExecuted(disputeId, d.escrowId, d.toolId, slashed);
        }
        emit DisputeRuled(disputeId, forBuyer);
    }
}
