// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDisputeArbiter} from "./interfaces/IDisputeArbiter.sol";
import {DisputeHarmBinding} from "./DisputeHarmBinding.sol";

/// @notice Minimal surface of a GOAT BitVM2 fraud-proof verifier. The real challenge-response
///         game runs in GOAT's BitVM2 node; this contract calls into it to adjudicate a challenge.
interface IBitVM2Verifier {
    /// @return fraudProven true if the challenged (optimistic) ruling was shown to be fraudulent.
    function verifyChallenge(bytes32 subject, bytes calldata proof)
        external
        returns (bool fraudProven);
}

/// @title BitVM2Arbiter
/// @notice The trust-minimized `IDisputeArbiter`: rulings are OPTIMISTIC. A proposed ruling
///         finalizes after a challenge window unless someone challenges it; a challenge escalates
///         to a BitVM2 fraud-proof verifier, whose verdict decides the outcome.
///
/// @dev    ⚠️  WHAT A FRAUD PROOF CAN AND CANNOT DECIDE — READ BEFORE AUTHORIZING.
///
///         BitVM2 proves that a **deterministic computation** was executed correctly. It cannot
///         prove a claim about the outside world. "This summary was low quality" or "this price
///         feed was wrong" are not statements about a program's execution, so no fraud proof
///         adjudicates them; treating BitVM2 as a general quality oracle is a category error.
///
///         This arbiter is therefore only sound for disputes whose subject is **re-executable
///         with committed inputs** — a tool that publishes `(inputs, output, sourceAttestation)`
///         so a verifier can recompute and compare. `verifyChallenge` is handed the disputed
///         receiptId as `subject` precisely so the verifier can look those commitments up.
///
///         For genuinely subjective output quality the honest options are (a) push the dispute
///         into an objective form — require tools to sign an attestation over their inputs and
///         source, which turns "wrong output" into "signature does not verify" — or (b) an
///         M-of-N staked verifier panel with commit–reveal and minority slashing. Neither is a
///         fraud proof. See docs/SECURITY.md §5.
///
///         MAINNET SAFETY: because `propose` sets the ruling direction and `rule` finalizes an
///         unchallenged proposal, an unchallenged (or un-challengeable) proposal is
///         authoritative. Until a REAL bidirectional verifier is wired via `setVerifier`, this
///         contract MUST NOT be granted `isArbiter` on QualityBond / EscrowVault on mainnet —
///         use the permissioned `DisputeArbiter` instead. The deploy scripts deliberately do
///         not authorize it.
contract BitVM2Arbiter is DisputeHarmBinding, ReentrancyGuard, IDisputeArbiter {
    using SafeERC20 for IERC20;

    enum Status {
        NONE,
        OPEN,
        PROPOSED,
        RULED
    }

    struct Dispute {
        bytes32 receiptId;
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

    uint256 public constant MIN_CHALLENGE_WINDOW = 1 hours;

    uint256 public disputeCount;
    mapping(uint256 => Dispute) public disputes;
    uint256 public challengeWindow = 1 hours;

    /// @notice Token staked by a proposer; returned on an unchallenged finalize, paid to the
    ///         challenger when fraud is proven.
    IERC20 public immutable stakeToken;
    /// @notice Stake required to propose a ruling (0 disables staking, testnet only).
    uint256 public proposalBond;

    IBitVM2Verifier public verifier;

    error NotOpen();
    error NotProposed();
    error WindowNotElapsed();
    error WindowElapsed();
    error WindowTooShort();
    error NoVerifier();
    error ChallengeFailed();

    event RulingProposed(
        uint256 indexed disputeId,
        address indexed proposer,
        bool forBuyer,
        uint64 finalizeAt,
        uint256 stake
    );
    event Challenged(uint256 indexed disputeId, address indexed challenger, uint256 stakePaid);
    event ProposalBondSet(uint256 amount);
    event VerifierSet(address indexed verifier);
    event ChallengeWindowSet(uint256 window);

    constructor(address initialOwner, address stakeToken_, uint256 proposalBond_)
        Ownable(initialOwner)
    {
        stakeToken = IERC20(stakeToken_);
        proposalBond = proposalBond_;
    }

    function setVerifier(address verifier_) external onlyOwner {
        verifier = IBitVM2Verifier(verifier_);
        emit VerifierSet(verifier_);
    }

    function setChallengeWindow(uint256 window) external onlyOwner {
        if (window < MIN_CHALLENGE_WINDOW) revert WindowTooShort();
        challengeWindow = window;
        emit ChallengeWindowSet(window);
    }

    function setProposalBond(uint256 amount) external onlyOwner {
        proposalBond = amount;
        emit ProposalBondSet(amount);
    }

    /// @inheritdoc IDisputeArbiter
    /// @notice Buyer-only and harm-bound, exactly as in `DisputeArbiter` — the shared base is
    ///         the single implementation of that check.
    function openDispute(bytes32 receiptId, uint256 escrowId, uint256 slashAmount)
        external
        nonReentrant
        returns (uint256 disputeId)
    {
        address buyer = msg.sender;
        (address seller, bytes32 toolId, uint256 harm) = _bindHarm(buyer, receiptId, escrowId);
        _validateSlash(seller, toolId, slashAmount, harm);
        _consumeHarm(receiptId, escrowId);

        disputeId = ++disputeCount;
        Dispute storage d = disputes[disputeId];
        d.receiptId = receiptId;
        d.buyer = buyer;
        d.seller = seller;
        d.toolId = toolId;
        d.escrowId = escrowId;
        d.slashAmount = slashAmount;
        d.status = Status.OPEN;

        emit DisputeOpened(disputeId, receiptId, buyer, seller, toolId);
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

        // The verifier is handed the disputed receiptId: everything it needs to recompute the
        // call (committed inputs, output, source attestation) hangs off that identifier.
        bool fraud = verifier.verifyChallenge(d.receiptId, proof);
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

    /// @dev Graceful, best-effort recourse via the shared base: the dispute always reaches RULED.
    function _finalize(uint256 disputeId, Dispute storage d, bool forBuyer) internal {
        d.status = Status.RULED;
        d.forBuyer = forBuyer;

        if (forBuyer) {
            _executeRecourse(disputeId, d.escrowId, d.toolId, d.slashAmount, d.buyer);
        } else {
            _releaseFreeze(disputeId, d.escrowId);
        }
        emit DisputeRuled(disputeId, forBuyer);
    }
}
