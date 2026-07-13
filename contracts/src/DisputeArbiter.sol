// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IDisputeArbiter} from "./interfaces/IDisputeArbiter.sol";

/// @dev Minimal surfaces of the contracts this arbiter drives on a ruling.
interface IQualityBondSlasher {
    function slash(bytes32 toolId, uint256 amount, address to) external;
}

interface IEscrowRefunder {
    function refund(uint256 escrowId) external;
}

/// @title DisputeArbiter
/// @notice Dispute window + on-chain ruling authority (PRD §5.4). Opens a dispute over a
///         settled receipt/hop, and on a buyer-favorable ruling it drives the recourse
///         path: refunding the linked `EscrowVault` escrow and slashing the tool's
///         `QualityBond`. Jurors (arbiter addresses) are pluggable via `IDisputeArbiter`.
///
/// @dev    Upgrade path: today rulings are recorded by a permissioned juror set (or an
///         off-chain verifier oracle such as ThoughtProof). The trust-minimized target is
///         a **BitVM2 fraud-proof / challenge-response arbiter** — GOAT built BitVM2 for
///         operator honesty; tiagoh reuses that challenge substrate to adjudicate
///         escrow-release / refund claims. Swap this contract for a BitVM2-backed
///         `IDisputeArbiter` implementation without touching QualityBond / EscrowVault.
contract DisputeArbiter is Ownable, IDisputeArbiter {
    enum Status {
        NONE,
        OPEN,
        RULED
    }

    struct Dispute {
        bytes32 subject;
        address buyer;
        address seller;
        bytes32 toolId;
        uint256 escrowId;
        uint256 slashAmount;
        uint256 deadline;
        Status status;
        bool forBuyer;
    }

    uint256 public disputeCount;
    mapping(uint256 => Dispute) public disputes;
    /// @dev pluggable arbiter/juror addresses (or a BitVM2 adjudicator contract)
    mapping(address => bool) public isJuror;

    uint256 public disputeWindow = 3 days;
    IQualityBondSlasher public qualityBond;
    IEscrowRefunder public escrowVault;

    error NotJuror();
    error NotOpen();
    error ZeroParty();

    event JurorSet(address indexed juror, bool allowed);
    event DisputeWindowSet(uint256 window);
    event RecourseTargetsSet(address qualityBond, address escrowVault);
    event RecourseExecuted(uint256 indexed disputeId, uint256 escrowId, bytes32 toolId, uint256 slashed);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyJuror() {
        if (!isJuror[msg.sender] && msg.sender != owner()) revert NotJuror();
        _;
    }

    function setJuror(address juror, bool allowed) external onlyOwner {
        isJuror[juror] = allowed;
        emit JurorSet(juror, allowed);
    }

    function setDisputeWindow(uint256 window) external onlyOwner {
        disputeWindow = window;
        emit DisputeWindowSet(window);
    }

    function setRecourseTargets(address qualityBond_, address escrowVault_) external onlyOwner {
        qualityBond = IQualityBondSlasher(qualityBond_);
        escrowVault = IEscrowRefunder(escrowVault_);
        emit RecourseTargetsSet(qualityBond_, escrowVault_);
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
        disputes[disputeId] = Dispute({
            subject: subject,
            buyer: buyer,
            seller: seller,
            toolId: toolId,
            escrowId: escrowId,
            slashAmount: slashAmount,
            deadline: block.timestamp + disputeWindow,
            status: Status.OPEN,
            forBuyer: false
        });
        emit DisputeOpened(disputeId, subject, buyer, seller, toolId);
    }

    /// @inheritdoc IDisputeArbiter
    /// @notice Rule on a dispute. A buyer-favorable ruling refunds the escrow (if set) and
    ///         slashes the bond (if set), routing the slash to the buyer.
    function rule(uint256 disputeId, bool forBuyer) external onlyJuror {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.OPEN) revert NotOpen();

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
