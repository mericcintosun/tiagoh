// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDisputeArbiter} from "./interfaces/IDisputeArbiter.sol";
import {DisputeHarmBinding} from "./DisputeHarmBinding.sol";

/// @title DisputeArbiter
/// @notice Dispute window + on-chain ruling authority (PRD §5.4). Opens a dispute over harm
///         proven on-chain — a co-signed receipt and/or a held escrow — and on a buyer-favorable
///         ruling drives the recourse path: refunding the escrow and slashing the tool's bond.
///         Harm binding and recourse live in `DisputeHarmBinding`, shared with `BitVM2Arbiter`.
///
/// @dev    Upgrade path: today rulings are recorded by a permissioned juror set (or an
///         off-chain verifier oracle such as ThoughtProof). The trust-minimized target is a
///         BitVM2 fraud-proof / challenge-response arbiter — but see `BitVM2Arbiter`'s notes
///         for the important limit on *what* a fraud proof can actually adjudicate.
///
///         Mainnet hardening beyond the shared base:
///         - The owner is NOT implicitly a juror. `rule` moves value, so the owner key must not
///           be able to call it; the owner may only (re)assign jurors, which a timelock makes
///           observable.
///         - Opening a dispute costs a **stake**, forfeited to the seller if the ruling goes
///           against the buyer. Disputes used to be free, which made griefing costless.
///         - Jurors must rule inside `rulingWindow`; afterwards anyone may `expire` the dispute,
///           which returns the stake and unfreezes the escrow. A silent juror cannot strand
///           funds — and, symmetrically, cannot sit on a dispute to keep a seller's escrow
///           frozen indefinitely.
contract DisputeArbiter is DisputeHarmBinding, ReentrancyGuard, IDisputeArbiter {
    using SafeERC20 for IERC20;

    enum Status {
        NONE,
        OPEN,
        RULED,
        EXPIRED
    }

    struct Dispute {
        bytes32 receiptId;
        address buyer;
        address seller;
        bytes32 toolId;
        uint256 escrowId;
        uint256 slashAmount;
        uint256 stake;
        uint64 rulingDeadline;
        Status status;
        bool forBuyer;
    }

    uint256 public disputeCount;
    mapping(uint256 => Dispute) public disputes;
    /// @dev pluggable juror addresses (a multisig, or an off-chain verifier oracle's key)
    mapping(address => bool) public isJuror;

    /// @notice How long a juror has to rule before anyone may expire the dispute.
    uint256 public rulingWindow = 7 days;
    /// @notice Stake a buyer posts to open a dispute (0 disables staking, testnet only).
    uint256 public disputeStake;

    IERC20 public immutable stakeToken;

    error NotJuror();
    error NotOpen();
    error RulingWindowOpen();
    error RulingWindowClosed();

    event JurorSet(address indexed juror, bool allowed);
    event RulingWindowSet(uint256 window);
    event DisputeStakeSet(uint256 amount);
    event StakeSettled(uint256 indexed disputeId, address indexed to, uint256 amount);

    constructor(address initialOwner, address stakeToken_) Ownable(initialOwner) {
        stakeToken = IERC20(stakeToken_);
    }

    /// @dev Least privilege: the owner is NOT a juror, because `rule` moves value.
    modifier onlyJuror() {
        if (!isJuror[msg.sender]) revert NotJuror();
        _;
    }

    function setJuror(address juror, bool allowed) external onlyOwner {
        isJuror[juror] = allowed;
        emit JurorSet(juror, allowed);
    }

    function setRulingWindow(uint256 window) external onlyOwner {
        rulingWindow = window;
        emit RulingWindowSet(window);
    }

    function setDisputeStake(uint256 amount) external onlyOwner {
        disputeStake = amount;
        emit DisputeStakeSet(amount);
    }

    /// @inheritdoc IDisputeArbiter
    function openDispute(bytes32 receiptId, uint256 escrowId, uint256 slashAmount)
        external
        nonReentrant
        returns (uint256 disputeId)
    {
        address buyer = msg.sender;
        (address seller, bytes32 toolId, uint256 harm) = _bindHarm(buyer, receiptId, escrowId);
        _validateSlash(seller, toolId, slashAmount, harm);
        _consumeHarm(receiptId, escrowId);

        uint256 stake = disputeStake;
        disputeId = ++disputeCount;
        disputes[disputeId] = Dispute({
            receiptId: receiptId,
            buyer: buyer,
            seller: seller,
            toolId: toolId,
            escrowId: escrowId,
            slashAmount: slashAmount,
            stake: stake,
            rulingDeadline: uint64(block.timestamp + rulingWindow),
            status: Status.OPEN,
            forBuyer: false
        });

        // Skin in the game: a frivolous dispute costs the buyer this stake.
        if (stake > 0) {
            stakeToken.safeTransferFrom(buyer, address(this), stake);
        }

        emit DisputeOpened(disputeId, receiptId, buyer, seller, toolId);
    }

    /// @inheritdoc IDisputeArbiter
    /// @notice Rule on a dispute. A buyer-favorable ruling refunds the escrow (if still held)
    ///         and slashes the bond (capped at the live amount), routing both to the buyer. A
    ///         seller-favorable ruling unfreezes the escrow and forfeits the buyer's stake to
    ///         the seller.
    function rule(uint256 disputeId, bool forBuyer) external onlyJuror nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.OPEN) revert NotOpen();
        if (block.timestamp > d.rulingDeadline) revert RulingWindowClosed();

        d.status = Status.RULED;
        d.forBuyer = forBuyer;

        if (forBuyer) {
            _executeRecourse(disputeId, d.escrowId, d.toolId, d.slashAmount, d.buyer);
        } else {
            _releaseFreeze(disputeId, d.escrowId);
        }

        _settleStake(disputeId, d, forBuyer ? d.buyer : d.seller);
        emit DisputeRuled(disputeId, forBuyer);
    }

    /// @notice Expire a dispute the jurors never ruled on. Permissionless once `rulingWindow`
    ///         has elapsed: the buyer's stake is returned (the failure was the juror's, not
    ///         theirs) and the escrow is unfrozen so the seller's claim path resumes. This is
    ///         the liveness guarantee against an absent or de-authorized juror set.
    function expire(uint256 disputeId) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.status != Status.OPEN) revert NotOpen();
        if (block.timestamp <= d.rulingDeadline) revert RulingWindowOpen();

        d.status = Status.EXPIRED;
        _releaseFreeze(disputeId, d.escrowId);
        _settleStake(disputeId, d, d.buyer);
        emit DisputeExpired(disputeId);
    }

    /// @dev Pays the dispute stake to `to`. Best-effort so a token that reverts on transfer can
    ///      never wedge a dispute out of a terminal state — the ruling itself is what matters.
    function _settleStake(uint256 disputeId, Dispute storage d, address to) internal {
        uint256 stake = d.stake;
        if (stake == 0) return;
        d.stake = 0;
        try stakeToken.transfer(to, stake) returns (bool ok) {
            if (ok) {
                emit StakeSettled(disputeId, to, stake);
            } else {
                emit StakeSettled(disputeId, address(0), 0);
            }
        } catch {
            emit StakeSettled(disputeId, address(0), 0);
        }
    }
}
