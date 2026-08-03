// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IQualityBondSlasher, IEscrowRefunder} from "./interfaces/IRecourse.sol";
import {IReceiptEvidence} from "./interfaces/IReceiptRegistry.sol";

/// @title DisputeHarmBinding
/// @notice The shared, security-critical half of every tiagoh arbiter: proving that a dispute
///         points at real harm, and executing recourse once a ruling lands.
///
/// @dev    Both `DisputeArbiter` (permissioned jurors) and `BitVM2Arbiter` (optimistic +
///         fraud proof) inherit this. Keeping one implementation is deliberate — the previous
///         design carried two hand-maintained copies of the harm check, which is exactly the
///         kind of duplication that drifts apart and leaves one arbiter exploitable.
///
///         Harm may be proven two ways:
///
///         1. A **co-signed receipt**. The instant-settle (charge-on-success) path leaves no
///            escrow, so the buyer's recourse is the seller's bond. `COSIGNED` is load-bearing:
///            a receipt written unilaterally by the seller's own gateway proves nothing, and
///            the buyer cannot mint one either — only a receipt both parties signed counts.
///         2. A **held escrow**. The insured path for higher-value calls, where the money is
///            still in the vault and can simply be refunded.
///
///         Whichever is used, the counterparty and the tool are DERIVED from the evidence
///         rather than supplied by the caller, and the slash is capped to
///         `min(provenHarm, liveBond)`.
abstract contract DisputeHarmBinding is Ownable2Step {
    uint8 internal constant ESCROW_STATE_HELD = 1; // EscrowVault.State.HELD

    IQualityBondSlasher public qualityBond;
    IEscrowRefunder public escrowVault;
    IReceiptEvidence public receiptRegistry;

    /// @notice How long after a receipt is anchored it may still be disputed. Without this a
    ///         year-old call could be dragged up against a seller's current bond.
    uint256 public disputeWindow = 3 days;

    /// @dev One dispute per piece of harm. Without these a buyer could re-litigate the same
    ///      receipt until the seller's entire bond was drained.
    mapping(bytes32 => bool) public receiptDisputed;
    mapping(uint256 => bool) public escrowDisputed;

    error NoHarm();
    error EscrowMismatch();
    error EscrowNotHeld();
    error ReceiptNotCosigned();
    error ReceiptNotBuyers();
    error PartyMismatch();
    error AlreadyDisputed();
    error DisputeWindowClosed();
    error SlashExceedsBond();
    error SlashExceedsHarm();
    error RecourseTargetUnset();

    event DisputeWindowSet(uint256 window);
    event RecourseTargetsSet(address qualityBond, address escrowVault, address receiptRegistry);
    event RecourseExecuted(
        uint256 indexed disputeId, uint256 escrowId, bytes32 toolId, uint256 slashed
    );
    event RecourseFailed(uint256 indexed disputeId, bytes32 step);

    function setDisputeWindow(uint256 window) external onlyOwner {
        disputeWindow = window;
        emit DisputeWindowSet(window);
    }

    function setRecourseTargets(
        address qualityBond_,
        address escrowVault_,
        address receiptRegistry_
    ) external onlyOwner {
        qualityBond = IQualityBondSlasher(qualityBond_);
        escrowVault = IEscrowRefunder(escrowVault_);
        receiptRegistry = IReceiptEvidence(receiptRegistry_);
        emit RecourseTargetsSet(qualityBond_, escrowVault_, receiptRegistry_);
    }

    /// @dev Derives the counterparty, the tool and the provable harm from on-chain evidence.
    ///      At least one of `receiptId` / `escrowId` must be supplied; when both are, they must
    ///      name the same seller, and the harm is the larger of the two so a call that is both
    ///      escrowed and receipted cannot be double-counted.
    function _bindHarm(address buyer, bytes32 receiptId, uint256 escrowId)
        internal
        view
        returns (address seller, bytes32 toolId, uint256 harm)
    {
        if (receiptId == bytes32(0) && escrowId == 0) revert NoHarm();

        if (receiptId != bytes32(0)) {
            if (address(receiptRegistry) == address(0)) revert RecourseTargetUnset();
            if (receiptDisputed[receiptId]) revert AlreadyDisputed();

            (
                address rPayer,
                address rPayee,
                uint256 rAmount,
                bytes32 rToolId,
                uint64 rTimestamp,
                bool cosigned
            ) = receiptRegistry.receiptEvidence(receiptId);

            if (!cosigned) revert ReceiptNotCosigned();
            if (rPayer != buyer) revert ReceiptNotBuyers();
            if (block.timestamp > uint256(rTimestamp) + disputeWindow) {
                revert DisputeWindowClosed();
            }

            seller = rPayee;
            toolId = rToolId;
            harm = rAmount;
        }

        if (escrowId != 0) {
            if (address(escrowVault) == address(0)) revert RecourseTargetUnset();
            if (escrowDisputed[escrowId]) revert AlreadyDisputed();

            (address ePayer, address ePayee, uint256 eAmount, bytes32 eToolId, uint8 state,) =
                escrowVault.escrowParties(escrowId);

            if (state != ESCROW_STATE_HELD) revert EscrowNotHeld();
            if (ePayer != buyer) revert EscrowMismatch();
            if (seller != address(0) && ePayee != seller) revert PartyMismatch();
            // Both pieces of evidence must agree on which tool is on the hook.
            if (toolId != bytes32(0) && eToolId != toolId) revert PartyMismatch();

            seller = ePayee;
            toolId = eToolId;
            if (eAmount > harm) harm = eAmount;
        }
    }

    /// @dev A slash must fit inside both the seller's live bond and the harm actually proven,
    ///      so a dispute's blast radius is the disputed call — never the seller's whole stake.
    function _validateSlash(address seller, bytes32 toolId, uint256 slashAmount, uint256 harm)
        internal
        view
    {
        if (slashAmount == 0) return;
        if (address(qualityBond) == address(0)) revert RecourseTargetUnset();
        (address bondSeller, uint256 bondAmt,,,) = qualityBond.bonds(toolId);
        if (bondSeller != seller) revert PartyMismatch();
        if (slashAmount > bondAmt) revert SlashExceedsBond();
        if (slashAmount > harm) revert SlashExceedsHarm();
    }

    /// @dev Marks the harm consumed and freezes an escrow for the duration of the dispute, so
    ///      neither party can settle it out from under the arbiter.
    function _consumeHarm(bytes32 receiptId, uint256 escrowId) internal {
        if (receiptId != bytes32(0)) receiptDisputed[receiptId] = true;
        if (escrowId != 0) {
            escrowDisputed[escrowId] = true;
            escrowVault.freeze(escrowId);
        }
    }

    /// @dev Buyer-favorable recourse: refund the escrow if it is still held, and slash the bond
    ///      capped at whatever is live now. Each external call is `try`-wrapped so a reverting
    ///      token or a de-authorized target can never wedge a dispute out of a terminal state;
    ///      failures surface as `RecourseFailed` rather than silently.
    function _executeRecourse(
        uint256 disputeId,
        uint256 escrowId,
        bytes32 toolId,
        uint256 slashAmount,
        address buyer
    ) internal returns (uint256 slashed) {
        if (escrowId != 0 && address(escrowVault) != address(0)) {
            (,,,, uint8 state,) = escrowVault.escrowParties(escrowId);
            if (state == ESCROW_STATE_HELD) {
                try escrowVault.refund(escrowId) {}
                catch {
                    emit RecourseFailed(disputeId, "refund");
                }
            }
        }
        if (slashAmount != 0 && address(qualityBond) != address(0)) {
            uint256 available = qualityBond.bondAmount(toolId);
            uint256 toSlash = slashAmount > available ? available : slashAmount;
            if (toSlash > 0) {
                try qualityBond.slash(toolId, toSlash, buyer) {
                    slashed = toSlash;
                } catch {
                    emit RecourseFailed(disputeId, "slash");
                }
            }
        }
        emit RecourseExecuted(disputeId, escrowId, toolId, slashed);
    }

    /// @dev Seller-favorable / expired outcome: lift the freeze so the normal claim path resumes.
    function _releaseFreeze(uint256 disputeId, uint256 escrowId) internal {
        if (escrowId == 0 || address(escrowVault) == address(0)) return;
        (,,,, uint8 state, bool disputed) = escrowVault.escrowParties(escrowId);
        if (state != ESCROW_STATE_HELD || !disputed) return;
        try escrowVault.unfreeze(escrowId) {}
        catch {
            emit RecourseFailed(disputeId, "unfreeze");
        }
    }
}
