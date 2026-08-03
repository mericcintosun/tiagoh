// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EscrowVault
/// @notice Conditional payment holds with atomic multi-hop cascade unwind (PRD §5.4 —
///         the world-first piece). A payment is held while the buyer can still dispute it,
///         then settles to the seller. Escrows tagged with a `cascadeId` can be unwound
///         together: when a downstream hop fails, `unwindCascade` refunds every still-held
///         escrow in that tree, respecting the all-or-nothing cascade policy.
///
/// @dev    SETTLEMENT DIRECTION (the important part). An escrow's `deadline` is the buyer's
///         dispute window, not a refund trigger:
///
///         - before the deadline, the buyer may `release` early (they are satisfied);
///         - after the deadline with no dispute, the **seller** may `claim` — the work was
///           delivered, so silence settles in the seller's favour;
///         - a refund only happens through adjudication (`refund`/`unwindCascade`, arbiter-only).
///
///         The earlier design let anyone refund to the payer once the deadline passed, which
///         meant a buyer could take the output, stay silent, and reclaim the money for free.
///         Timeouts must never default in favour of the party who already received value.
///
///         Liveness: opening a dispute `freeze`s an escrow so neither side can settle it out
///         from under the arbiter. If the arbiter then goes dark, `resolveStale` lets anyone
///         settle the escrow in its default direction (to the seller) once `staleAfter` has
///         elapsed past the deadline, so funds can never be locked forever.
///
///         Other mainnet hardening:
///         - The owner is NOT implicitly an arbiter (least privilege); only addresses granted
///           via `setArbiter` can refund/unwind/freeze on someone's behalf.
///         - `deposit` books the ACTUAL received amount (balanceOf delta), so a fee-on-transfer
///           or rebasing token cannot leave the pooled balance under-collateralized.
///         - A `cascadeId` is owned by whoever registered it, and only that registrar or a
///           payee already paid inside the tree may join it — so an attacker can no longer
///           bloat a victim's cascade with poison escrows.
///         - `unwindCascade` is best-effort per escrow (via `try`), so a single poison escrow
///           whose token reverts on transfer cannot brick the whole cascade's atomic unwind.
contract EscrowVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        NONE,
        HELD,
        RELEASED,
        REFUNDED
    }

    /// @dev Packed into 5 slots: {payer, deadline, state, disputed} share slot 0.
    struct Escrow {
        address payer;
        uint64 deadline;
        State state;
        bool disputed;
        address payee;
        IERC20 token;
        uint256 amount;
        bytes32 cascadeId;
        /// @dev The tool this payment is for. An escrow is always payment for a specific call,
        ///      and recording that is what lets an arbiter bind a bond slash to the right tool
        ///      without trusting a caller-supplied identifier.
        bytes32 toolId;
    }

    uint256 public escrowCount;
    mapping(uint256 => Escrow) public escrows;
    /// @dev cascadeId => escrow ids in the tree
    mapping(bytes32 => uint256[]) public cascadeEscrows;
    /// @dev cascadeId => the address that first tagged it (its owner)
    mapping(bytes32 => address) public cascadeRegistrar;
    /// @dev cascadeId => addresses paid inside the tree, who may therefore fund sub-hops of it
    mapping(bytes32 => mapping(address => bool)) public isCascadeParticipant;
    /// @dev authorized arbiters (DisputeArbiter) that can refund/unwind/freeze
    mapping(address => bool) public isArbiter;
    /// @notice Guarded-launch cap: max tokens a single escrow may hold (0 = unlimited). Lets a
    ///         pre-audit mainnet bound the value at risk per escrow, raised as confidence grows.
    uint256 public maxEscrow;
    /// @notice How long past the deadline a frozen escrow may sit before anyone can settle it
    ///         in its default direction. The arbiter-outage backstop.
    uint256 public staleAfter = 30 days;

    error NotArbiter();
    error NotAuthorizedToRelease();
    error NotPayee();
    error NotHeld();
    error NotExpired();
    error NotStale();
    error Disputed();
    error NotDisputed();
    error ZeroAmount();
    error ZeroPayee();
    error OnlySelf();
    error ExceedsCap();
    error ZeroDuration();
    error DurationTooLong();
    error NotCascadeParticipant(bytes32 cascadeId, address who);

    event ArbiterSet(address indexed arbiter, bool allowed);
    event MaxEscrowSet(uint256 maxEscrow);
    event StaleAfterSet(uint256 staleAfter);
    event CascadeRegistered(bytes32 indexed cascadeId, address indexed registrar);
    event Deposited(
        uint256 indexed escrowId,
        bytes32 indexed cascadeId,
        address indexed payer,
        address payee,
        address token,
        uint256 amount,
        uint256 deadline
    );
    event Released(uint256 indexed escrowId, address indexed payee, uint256 amount);
    event Claimed(uint256 indexed escrowId, address indexed payee, uint256 amount);
    event Refunded(uint256 indexed escrowId, address indexed payer, uint256 amount);
    event RefundSkipped(uint256 indexed escrowId);
    event Frozen(uint256 indexed escrowId);
    event Unfrozen(uint256 indexed escrowId);
    event StaleResolved(uint256 indexed escrowId, address indexed payee, uint256 amount);
    event CascadeUnwound(bytes32 indexed cascadeId, uint256 refundedCount, uint256 totalRefunded);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @dev Least privilege: owner is not implicitly an arbiter (see contract notes).
    modifier onlyArbiter() {
        if (!isArbiter[msg.sender]) revert NotArbiter();
        _;
    }

    function setArbiter(address arbiter, bool allowed) external onlyOwner {
        isArbiter[arbiter] = allowed;
        emit ArbiterSet(arbiter, allowed);
    }

    /// @notice Set the per-escrow deposit cap (0 = unlimited). Guarded-launch control.
    function setMaxEscrow(uint256 cap) external onlyOwner {
        maxEscrow = cap;
        emit MaxEscrowSet(cap);
    }

    /// @notice Set how long past its deadline a frozen escrow may sit before `resolveStale`.
    function setStaleAfter(uint256 window) external onlyOwner {
        staleAfter = window;
        emit StaleAfterSet(window);
    }

    /// @notice Deposit a conditional payment; pulls the token from the caller (payer) and books
    ///         the amount actually received (fee-on-transfer / rebasing safe).
    /// @param duration  The buyer's dispute window. After it elapses the payee may `claim`.
    /// @param cascadeId Tag linking this escrow to a cascade tree (0 for standalone). The first
    ///                  depositor registers the tag; afterwards only the registrar or an address
    ///                  already paid inside the tree may add to it.
    /// @param toolId    The tool being paid for, so a dispute can bind a slash to its bond.
    function deposit(
        address payee,
        address token,
        uint256 amount,
        uint256 duration,
        bytes32 cascadeId,
        bytes32 toolId
    ) external nonReentrant returns (uint256 escrowId) {
        if (amount == 0) revert ZeroAmount();
        if (payee == address(0)) revert ZeroPayee();
        if (duration == 0) revert ZeroDuration();
        if (duration > type(uint64).max - block.timestamp) revert DurationTooLong();

        if (maxEscrow != 0 && amount > maxEscrow) revert ExceedsCap();

        if (cascadeId != bytes32(0)) {
            _joinCascade(cascadeId, payee);
        }

        IERC20 t = IERC20(token);
        uint256 balBefore = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = t.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroAmount();
        if (maxEscrow != 0 && received > maxEscrow) revert ExceedsCap();

        uint64 deadline = uint64(block.timestamp + duration);
        escrowId = ++escrowCount;
        escrows[escrowId] = Escrow({
            payer: msg.sender,
            deadline: deadline,
            state: State.HELD,
            disputed: false,
            payee: payee,
            token: t,
            amount: received,
            cascadeId: cascadeId,
            toolId: toolId
        });
        if (cascadeId != bytes32(0)) {
            cascadeEscrows[cascadeId].push(escrowId);
        }
        emit Deposited(escrowId, cascadeId, msg.sender, payee, token, received, deadline);
    }

    /// @dev Cascade membership. The first depositor owns the tag. After that, only the registrar
    ///      or someone already paid inside the tree may fund a hop of it — which is exactly the
    ///      real topology (a tool paid by a parent hop goes on to pay its own sub-tools). This
    ///      closes the griefing path where anyone could push escrows into a victim's cascadeId
    ///      and force the arbiter to unwind an ever-growing array.
    function _joinCascade(bytes32 cascadeId, address payee) internal {
        address registrar = cascadeRegistrar[cascadeId];
        if (registrar == address(0)) {
            cascadeRegistrar[cascadeId] = msg.sender;
            isCascadeParticipant[cascadeId][msg.sender] = true;
            emit CascadeRegistered(cascadeId, msg.sender);
        } else if (!isCascadeParticipant[cascadeId][msg.sender]) {
            revert NotCascadeParticipant(cascadeId, msg.sender);
        }
        // Being paid inside the tree grants the right to fund sub-hops of it.
        isCascadeParticipant[cascadeId][payee] = true;
    }

    /// @notice Release a held escrow to the payee. Callable by the payer (early confirmation)
    ///         or an authorized arbiter (a seller-favourable ruling).
    function release(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        bool arbiter = isArbiter[msg.sender];
        if (msg.sender != e.payer && !arbiter) revert NotAuthorizedToRelease();
        // While a dispute is open only the arbiter decides; the payer cannot settle around it.
        if (e.disputed && !arbiter) revert Disputed();

        e.state = State.RELEASED;
        e.token.safeTransfer(e.payee, e.amount);
        emit Released(escrowId, e.payee, e.amount);
    }

    /// @notice Payee claims a held escrow once the buyer's dispute window has elapsed with no
    ///         dispute open. This is the default settlement direction: work was delivered and
    ///         not contested, so the money is the seller's.
    function claim(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        if (msg.sender != e.payee) revert NotPayee();
        if (block.timestamp < e.deadline) revert NotExpired();
        if (e.disputed) revert Disputed();

        e.state = State.RELEASED;
        e.token.safeTransfer(e.payee, e.amount);
        emit Claimed(escrowId, e.payee, e.amount);
    }

    /// @notice Refund a held escrow to the payer. Arbiter-only: a refund is an adjudicated
    ///         outcome, never something either party can help themselves to.
    function refund(uint256 escrowId) external onlyArbiter nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        _refund(escrowId, e);
    }

    /// @notice Freeze a held escrow while a dispute is being adjudicated. Arbiter-only.
    function freeze(uint256 escrowId) external onlyArbiter {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        e.disputed = true;
        emit Frozen(escrowId);
    }

    /// @notice Lift a freeze without moving funds (e.g. a seller-favourable ruling that lets the
    ///         normal `claim` path resume). Arbiter-only.
    function unfreeze(uint256 escrowId) external onlyArbiter {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        if (!e.disputed) revert NotDisputed();
        e.disputed = false;
        emit Unfrozen(escrowId);
    }

    /// @notice Liveness backstop: if an escrow is still held `staleAfter` past its deadline —
    ///         because the arbiter never ruled on an open dispute — anyone may settle it in its
    ///         default direction (to the payee). Funds can never be locked forever by a silent
    ///         or de-authorized arbiter.
    function resolveStale(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        if (block.timestamp < uint256(e.deadline) + staleAfter) revert NotStale();

        e.state = State.RELEASED;
        e.disputed = false;
        e.token.safeTransfer(e.payee, e.amount);
        emit StaleResolved(escrowId, e.payee, e.amount);
    }

    /// @notice Atomically refund every still-held escrow in a cascade tree to its payer.
    /// @dev    The core §5.4 primitive. Best-effort per escrow: a poison escrow whose token
    ///         reverts on transfer is skipped (RefundSkipped) rather than reverting the batch,
    ///         so one bad token cannot brick the unwind. Legit escrows all refund in one
    ///         transaction.
    function unwindCascade(bytes32 cascadeId) external onlyArbiter nonReentrant {
        _unwind(cascadeId, 0, cascadeEscrows[cascadeId].length);
    }

    /// @notice Ranged unwind for cascades whose escrow list has grown past a single
    ///         transaction's gas. Processes `[start, start + maxCount)` of the cascade's list.
    function unwindCascadeRange(bytes32 cascadeId, uint256 start, uint256 maxCount)
        external
        onlyArbiter
        nonReentrant
    {
        _unwind(cascadeId, start, maxCount);
    }

    function _unwind(bytes32 cascadeId, uint256 start, uint256 maxCount) internal {
        uint256[] storage ids = cascadeEscrows[cascadeId];
        uint256 len = ids.length;
        uint256 end = start + maxCount;
        if (end > len) end = len;

        uint256 total;
        uint256 n;
        for (uint256 i = start; i < end; ++i) {
            uint256 id = ids[i];
            Escrow storage e = escrows[id];
            if (e.state != State.HELD) continue;
            uint256 amt = e.amount;
            // Best-effort: an external self-call so a reverting (poison) token is caught and
            // skipped instead of reverting the whole batch. `refundHeld` is self-only.
            try this.refundHeld(id) {
                total += amt;
                ++n;
            } catch {
                emit RefundSkipped(id);
            }
        }
        emit CascadeUnwound(cascadeId, n, total);
    }

    /// @notice Internal-refund entrypoint used by `unwindCascade` via `try this.refundHeld`.
    ///         Callable only by this contract; not part of the external API.
    function refundHeld(uint256 escrowId) external {
        if (msg.sender != address(this)) revert OnlySelf();
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) return;
        _refund(escrowId, e);
    }

    function _refund(uint256 escrowId, Escrow storage e) internal {
        e.state = State.REFUNDED;
        e.disputed = false;
        e.token.safeTransfer(e.payer, e.amount);
        emit Refunded(escrowId, e.payer, e.amount);
    }

    function cascadeEscrowCount(bytes32 cascadeId) external view returns (uint256) {
        return cascadeEscrows[cascadeId].length;
    }

    /// @notice Purpose-built read for arbiters validating a dispute's harm. Explicitly named and
    ///         ordered so consumers never depend on the packed struct's declaration order.
    function escrowParties(uint256 escrowId)
        external
        view
        returns (
            address payer,
            address payee,
            uint256 amount,
            bytes32 toolId,
            uint8 state,
            bool disputed
        )
    {
        Escrow storage e = escrows[escrowId];
        return (e.payer, e.payee, e.amount, e.toolId, uint8(e.state), e.disputed);
    }
}
