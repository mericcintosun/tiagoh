// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDisputeArbiter} from "./interfaces/IDisputeArbiter.sol";
import {IQualityBondSlasher, IEscrowRefunder} from "./interfaces/IRecourse.sol";

/// @notice Minimal surface of a GOAT BitVM2 fraud-proof verifier. The real challenge-response
///         game runs in GOAT's BitVM2 node; this contract calls into it to adjudicate a challenge.
interface IBitVM2Verifier {
    /// @return fraudProven true if the challenged (optimistic) ruling was shown to be fraudulent.
    function verifyChallenge(bytes32 subject, bytes calldata proof) external returns (bool fraudProven);
}

/// @title BitVM2Arbiter
/// @notice The trust-minimized `IDisputeArbiter`: rulings are OPTIMISTIC. A proposed ruling
///         finalizes after a challenge window unless someone challenges it; a challenge escalates
///         to a BitVM2 fraud-proof verifier, whose verdict decides the outcome.
///
/// @dev    ⚠️  MAINNET SAFETY — READ BEFORE AUTHORIZING.
///         The optimistic model is only as safe as its verifier. Because `propose` sets the
///         ruling direction and `rule` finalizes an unchallenged proposal, an unchallenged
///         (or un-challengeable) proposal is authoritative. Until GOAT's REAL bidirectional
///         BitVM2 verifier is wired via `setVerifier` (one that can adjudicate the actual
///         `subject`, not a stub), this contract MUST NOT be granted `isArbiter` on QualityBond
///         / EscrowVault on mainnet — use the permissioned `DisputeArbiter` instead. See
///         docs/SECURITY.md. This file ships harm-binding, a snapshotted challenge window,
///         proposer staking, and best-effort recourse so it is ready to wire once the verifier
///         exists, but it is deliberately NOT authorized by the deploy scripts.
contract BitVM2Arbiter is Ownable2Step, ReentrancyGuard, IDisputeArbiter {
    using SafeERC20 for IERC20;

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
        address proposer;
        uint256 proposerStake;
        bool proposedForBuyer;
        uint64 finalizeAt; // snapshotted at propose time; immune to later setChallengeWindow
        Status status;
        bool forBuyer;
    }

    uint8 internal constant ESCROW_STATE_HELD = 1; // EscrowVault.State.HELD

    uint256 public constant MIN_CHALLENGE_WINDOW = 1 hours;

    uint256 public disputeCount;
    mapping(uint256 => Dispute) public disputes;
    uint256 public challengeWindow = 1 hours;

    /// @notice Token staked by a proposer; returned on an unchallenged finalize, paid to the
    ///         challenger when fraud is proven.
    IERC20 public immutable stakeToken;
    /// @notice Stake required to propose a ruling (0 disables staking, testnet only).
    uint256 public proposalBond;

    IQualityBondSlasher public qualityBond;
    IEscrowRefunder public escrowVault;
    IBitVM2Verifier public verifier;

    error NotOpen();
    error NotProposed();
    error WindowNotElapsed();
    error WindowElapsed();
    error WindowTooShort();
    error NoVerifier();
    error ZeroParty();
    error NotBuyer();
    error EscrowMismatch();
    error SlashExceedsBond();
    error SlashNeedsEscrow();
    error SlashExceedsHarm();
    error RecourseTargetUnset();
    error ChallengeFailed();

    event RulingProposed(
        uint256 indexed disputeId, address indexed proposer, bool forBuyer, uint64 finalizeAt, uint256 stake
    );
    event Challenged(uint256 indexed disputeId, address indexed challenger, uint256 stakePaid);
    event RecourseExecuted(uint256 indexed disputeId, uint256 escrowId, bytes32 toolId, uint256 slashed);
    event RecourseFailed(uint256 indexed disputeId, bytes32 step);
    event ProposalBondSet(uint256 amount);

    constructor(address initialOwner, address stakeToken_, uint256 proposalBond_) Ownable(initialOwner) {
        stakeToken = IERC20(stakeToken_);
        proposalBond = proposalBond_;
    }

    function setRecourseTargets(address qualityBond_, address escrowVault_) external onlyOwner {
        qualityBond = IQualityBondSlasher(qualityBond_);
        escrowVault = IEscrowRefunder(escrowVault_);
    }

    function setVerifier(address verifier_) external onlyOwner {
        verifier = IBitVM2Verifier(verifier_);
    }

    function setChallengeWindow(uint256 window) external onlyOwner {
        if (window < MIN_CHALLENGE_WINDOW) revert WindowTooShort();
        challengeWindow = window;
    }

    function setProposalBond(uint256 amount) external onlyOwner {
        proposalBond = amount;
        emit ProposalBondSet(amount);
    }

    /// @inheritdoc IDisputeArbiter
    /// @notice Buyer-only, harm-bound: a slash must reference a real HELD escrow the buyer funded
    ///         to this seller, capped to both the live bond and the escrowed amount.
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
        _validateHarm(buyer, seller, toolId, escrowId, slashAmount);

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

    /// @dev Harm-binding: a slash must reference a real HELD escrow the buyer funded to this
    ///      seller, capped to both the live bond and the escrowed amount.
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

    /// @notice Propose an optimistic ruling. Requires a configured verifier and a proposer stake.
    ///         The challenge deadline is snapshotted now, so a later `setChallengeWindow` cannot
    ///         retroactively resize this dispute's window.
    function propose(uint256 disputeId, bool forBuyer) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.OPEN) revert NotOpen();
        if (address(verifier) == address(0)) revert NoVerifier();

        uint256 stake = proposalBond;
        uint64 finalizeAt = uint64(block.timestamp + challengeWindow);
        d.proposer = msg.sender;
        d.proposerStake = stake;
        d.proposedForBuyer = forBuyer;
        d.finalizeAt = finalizeAt;
        d.status = Status.PROPOSED;

        if (stake > 0) {
            stakeToken.safeTransferFrom(msg.sender, address(this), stake);
        }
        emit RulingProposed(disputeId, msg.sender, forBuyer, finalizeAt, stake);
    }

    /// @notice Challenge a proposed ruling within the window; escalates to the BitVM2 verifier.
    ///         If fraud is proven the ruling is flipped and the proposer's stake goes to the
    ///         challenger. A failed challenge REVERTS (never finalizes early).
    function challenge(uint256 disputeId, bytes calldata proof) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.PROPOSED) revert NotProposed();
        if (block.timestamp > d.finalizeAt) revert WindowElapsed();
        if (address(verifier) == address(0)) revert NoVerifier();

        bool fraud = verifier.verifyChallenge(d.subject, proof);
        if (!fraud) revert ChallengeFailed();

        uint256 stake = d.proposerStake;
        d.proposerStake = 0;
        if (stake > 0) {
            stakeToken.safeTransfer(msg.sender, stake);
        }
        emit Challenged(disputeId, msg.sender, stake);
        _finalize(disputeId, d, !d.proposedForBuyer);
    }

    /// @inheritdoc IDisputeArbiter
    /// @notice Finalize an unchallenged proposal after the window. Returns the proposer's stake
    ///         unconditionally (decoupled from recourse success, so a downstream refund/slash
    ///         revert can never hold the honest proposer's stake hostage).
    function rule(uint256 disputeId, bool forBuyer) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.PROPOSED) revert NotProposed();
        if (block.timestamp <= d.finalizeAt) revert WindowNotElapsed();
        forBuyer; // silence unused; the proposal is authoritative

        uint256 stake = d.proposerStake;
        d.proposerStake = 0;
        if (stake > 0) {
            stakeToken.safeTransfer(d.proposer, stake);
        }
        _finalize(disputeId, d, d.proposedForBuyer);
    }

    /// @dev Graceful, best-effort recourse: re-check the escrow is still held, cap the slash at
    ///      the live bond, and wrap each external call in `try` so a reverting token / de-authed
    ///      target cannot brick finalize (the dispute always reaches RULED).
    function _finalize(uint256 disputeId, Dispute storage d, bool forBuyer) internal {
        d.status = Status.RULED;
        d.forBuyer = forBuyer;

        uint256 slashed;
        if (forBuyer) {
            if (address(escrowVault) != address(0) && d.escrowId != 0) {
                (,,,,,, uint8 state) = escrowVault.escrows(d.escrowId);
                if (state == ESCROW_STATE_HELD) {
                    try escrowVault.refund(d.escrowId) {}
                    catch {
                        emit RecourseFailed(disputeId, "refund");
                    }
                }
            }
            if (address(qualityBond) != address(0) && d.slashAmount != 0) {
                uint256 available = qualityBond.bondAmount(d.toolId);
                uint256 toSlash = d.slashAmount > available ? available : d.slashAmount;
                if (toSlash > 0) {
                    try qualityBond.slash(d.toolId, toSlash, d.buyer) {
                        slashed = toSlash;
                    } catch {
                        emit RecourseFailed(disputeId, "slash");
                    }
                }
            }
            emit RecourseExecuted(disputeId, d.escrowId, d.toolId, slashed);
        }
        emit DisputeRuled(disputeId, forBuyer);
    }
}
