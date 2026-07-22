// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDisputeArbiter} from "./interfaces/IDisputeArbiter.sol";
import {IQualityBondSlasher, IEscrowRefunder} from "./interfaces/IRecourse.sol";

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
///
///         Mainnet hardening: `openDispute` is buyer-only and cross-checks the referenced
///         escrow / bond, and recourse executes gracefully at ruling time (skip a
///         no-longer-held escrow, cap the slash at the live bond) so a ruling can never be
///         bricked by state that moved after open.
contract DisputeArbiter is Ownable2Step, ReentrancyGuard, IDisputeArbiter {
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

    uint8 internal constant ESCROW_STATE_HELD = 1; // EscrowVault.State.HELD

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
    error NotBuyer();
    error EscrowMismatch();
    error SlashExceedsBond();
    error SlashNeedsEscrow();
    error SlashExceedsHarm();
    error RecourseTargetUnset();

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
    /// @notice Buyer-only. The referenced escrow must be the buyer's own held escrow against
    ///         this seller, and the requested slash must fit inside the tool's live bond.
    function openDispute(
        bytes32 subject,
        address buyer,
        address seller,
        bytes32 toolId,
        uint256 escrowId,
        uint256 slashAmount
    ) external returns (uint256 disputeId) {
        if (buyer == address(0) || seller == address(0)) revert ZeroParty();
        if (msg.sender != buyer) revert NotBuyer();
        // Harm-binding: a slash must reference a real HELD escrow the buyer funded to this seller,
        // capped to what was escrowed — ownership alone is not enough. This caps a dispute's blast
        // radius to the disputed escrow so a frivolous dispute cannot target a seller's whole bond.
        _validateHarm(buyer, seller, toolId, escrowId, slashAmount);

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

    function _validateHarm(
        address buyer,
        address seller,
        bytes32 toolId,
        uint256 escrowId,
        uint256 slashAmount
    ) internal view {
        uint256 escrowAmount;
        if (escrowId != 0) {
            if (address(escrowVault) == address(0)) revert RecourseTargetUnset();
            (address payer, address payee,, uint256 amount,,, uint8 state) = escrowVault.escrows(escrowId);
            if (payer != buyer || payee != seller || state != ESCROW_STATE_HELD) revert EscrowMismatch();
            escrowAmount = amount;
        }
        if (slashAmount != 0) {
            if (escrowId == 0) revert SlashNeedsEscrow();
            if (address(qualityBond) == address(0)) revert RecourseTargetUnset();
            (address bondSeller, uint256 bondAmt,,,) = qualityBond.bonds(toolId);
            if (bondSeller != seller) revert EscrowMismatch();
            if (slashAmount > bondAmt) revert SlashExceedsBond();
            if (slashAmount > escrowAmount) revert SlashExceedsHarm();
        }
    }

    /// @inheritdoc IDisputeArbiter
    /// @notice Rule on a dispute. A buyer-favorable ruling refunds the escrow (if still held)
    ///         and slashes the bond (capped at the live amount), routing the slash to the buyer.
    function rule(uint256 disputeId, bool forBuyer) external onlyJuror nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.OPEN) revert NotOpen();

        d.status = Status.RULED;
        d.forBuyer = forBuyer;

        uint256 slashed;
        if (forBuyer) {
            if (address(escrowVault) != address(0) && d.escrowId != 0) {
                (,,,,,, uint8 state) = escrowVault.escrows(d.escrowId);
                if (state == ESCROW_STATE_HELD) {
                    escrowVault.refund(d.escrowId);
                }
            }
            if (address(qualityBond) != address(0) && d.slashAmount != 0) {
                uint256 available = qualityBond.bondAmount(d.toolId);
                uint256 toSlash = d.slashAmount > available ? available : d.slashAmount;
                if (toSlash > 0) {
                    qualityBond.slash(d.toolId, toSlash, d.buyer);
                    slashed = toSlash;
                }
            }
            emit RecourseExecuted(disputeId, d.escrowId, d.toolId, slashed);
        }

        emit DisputeRuled(disputeId, forBuyer);
    }
}
