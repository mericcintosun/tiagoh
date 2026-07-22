// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EscrowVault
/// @notice Conditional payment holds with atomic multi-hop cascade unwind (PRD §5.4 —
///         the world-first piece). A payment is held until the buyer confirms usefulness
///         (`release`) or the hold times out (`refund`). Escrows tagged with a `cascadeId`
///         can be unwound together: when a downstream hop fails, `unwindCascade` refunds
///         every still-held escrow in that tree, respecting the all-or-nothing cascade policy.
///
/// @dev    Mainnet hardening:
///         - The owner is NOT implicitly an arbiter (least privilege); only addresses granted
///           via `setArbiter` can release/refund/unwind on someone's behalf.
///         - `deposit` books the ACTUAL received amount (balanceOf delta), so a fee-on-transfer
///           or rebasing token cannot leave the pooled balance under-collateralized.
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

    struct Escrow {
        address payer;
        address payee;
        IERC20 token;
        uint256 amount;
        uint256 deadline;
        bytes32 cascadeId;
        State state;
    }

    uint256 public escrowCount;
    mapping(uint256 => Escrow) public escrows;
    /// @dev cascadeId => escrow ids in the tree
    mapping(bytes32 => uint256[]) public cascadeEscrows;
    /// @dev authorized arbiters (DisputeArbiter) that can release/refund/unwind
    mapping(address => bool) public isArbiter;

    error NotArbiter();
    error NotAuthorizedToRelease();
    error NotHeld();
    error NotExpired();
    error ZeroAmount();
    error ZeroPayee();
    error OnlySelf();

    event ArbiterSet(address indexed arbiter, bool allowed);
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
    event Refunded(uint256 indexed escrowId, address indexed payer, uint256 amount);
    event RefundSkipped(uint256 indexed escrowId);
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

    /// @notice Deposit a conditional payment; pulls the token from the caller (payer) and books
    ///         the amount actually received (fee-on-transfer / rebasing safe).
    /// @param cascadeId  Tag linking this escrow to a cascade tree (0 for standalone).
    function deposit(
        address payee,
        address token,
        uint256 amount,
        uint256 duration,
        bytes32 cascadeId
    ) external nonReentrant returns (uint256 escrowId) {
        if (amount == 0) revert ZeroAmount();
        if (payee == address(0)) revert ZeroPayee();

        IERC20 t = IERC20(token);
        uint256 balBefore = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = t.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroAmount();

        uint256 deadline = block.timestamp + duration;
        escrowId = ++escrowCount;
        escrows[escrowId] = Escrow({
            payer: msg.sender,
            payee: payee,
            token: t,
            amount: received,
            deadline: deadline,
            cascadeId: cascadeId,
            state: State.HELD
        });
        if (cascadeId != bytes32(0)) {
            cascadeEscrows[cascadeId].push(escrowId);
        }
        emit Deposited(escrowId, cascadeId, msg.sender, payee, token, received, deadline);
    }

    /// @notice Release a held escrow to the payee. Callable by the payer (confirmation)
    ///         or an authorized arbiter.
    function release(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        if (msg.sender != e.payer && !isArbiter[msg.sender]) {
            revert NotAuthorizedToRelease();
        }
        e.state = State.RELEASED;
        e.token.safeTransfer(e.payee, e.amount);
        emit Released(escrowId, e.payee, e.amount);
    }

    /// @notice Refund a held escrow to the payer. Anyone may trigger after the deadline;
    ///         an authorized arbiter may refund at any time (e.g. adjudicated failure).
    function refund(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        if (!isArbiter[msg.sender] && block.timestamp < e.deadline) revert NotExpired();
        _refund(escrowId, e);
    }

    /// @notice Atomically refund every still-held escrow in a cascade tree to its payer.
    /// @dev    The core §5.4 primitive. Best-effort per escrow: a poison escrow whose token
    ///         reverts on transfer is skipped (RefundSkipped) rather than reverting the batch,
    ///         so an attacker cannot brick the unwind by injecting a malicious-token escrow into
    ///         a victim's cascadeId. Legit escrows all refund in one transaction.
    function unwindCascade(bytes32 cascadeId) external onlyArbiter nonReentrant {
        _unwind(cascadeId, 0, cascadeEscrows[cascadeId].length);
    }

    /// @notice Ranged unwind for cascades whose escrow list has grown past a single
    ///         transaction's gas (anyone can deposit into an arbitrary cascadeId, so the
    ///         full-list variant is griefable by bloating the array). Processes
    ///         `[start, start + maxCount)` of the cascade's escrow list.
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
        e.token.safeTransfer(e.payer, e.amount);
        emit Refunded(escrowId, e.payer, e.amount);
    }

    function cascadeEscrowCount(bytes32 cascadeId) external view returns (uint256) {
        return cascadeEscrows[cascadeId].length;
    }
}
