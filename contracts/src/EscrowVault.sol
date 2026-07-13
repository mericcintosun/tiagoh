// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EscrowVault
/// @notice Conditional payment holds with atomic multi-hop cascade unwind (PRD §5.4 —
///         the world-first piece). A payment is held until the buyer confirms usefulness
///         (`release`) or the hold times out (`refund`). Escrows tagged with a `cascadeId`
///         can be unwound together: when a downstream hop fails, `unwindCascade` refunds
///         every still-held escrow in that tree in one atomic transaction, respecting the
///         all-or-nothing cascade policy.
contract EscrowVault is Ownable, ReentrancyGuard {
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
    event CascadeUnwound(bytes32 indexed cascadeId, uint256 refundedCount, uint256 totalRefunded);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyArbiter() {
        if (!isArbiter[msg.sender] && msg.sender != owner()) revert NotArbiter();
        _;
    }

    function setArbiter(address arbiter, bool allowed) external onlyOwner {
        isArbiter[arbiter] = allowed;
        emit ArbiterSet(arbiter, allowed);
    }

    /// @notice Deposit a conditional payment; pulls `amount` from the caller (payer).
    /// @param cascadeId  Tag linking this escrow to a cascade tree (0 for standalone).
    function deposit(
        address payee,
        address token,
        uint256 amount,
        uint256 duration,
        bytes32 cascadeId
    ) external nonReentrant returns (uint256 escrowId) {
        if (amount == 0) revert ZeroAmount();
        uint256 deadline = block.timestamp + duration;
        escrowId = ++escrowCount;
        escrows[escrowId] = Escrow({
            payer: msg.sender,
            payee: payee,
            token: IERC20(token),
            amount: amount,
            deadline: deadline,
            cascadeId: cascadeId,
            state: State.HELD
        });
        if (cascadeId != bytes32(0)) {
            cascadeEscrows[cascadeId].push(escrowId);
        }
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(escrowId, cascadeId, msg.sender, payee, token, amount, deadline);
    }

    /// @notice Release a held escrow to the payee. Callable by the payer (confirmation)
    ///         or an arbiter/owner.
    function release(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        if (msg.sender != e.payer && !isArbiter[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedToRelease();
        }
        e.state = State.RELEASED;
        e.token.safeTransfer(e.payee, e.amount);
        emit Released(escrowId, e.payee, e.amount);
    }

    /// @notice Refund a held escrow to the payer. Anyone may trigger after the deadline;
    ///         an arbiter/owner may refund at any time (e.g. adjudicated failure).
    function refund(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.state != State.HELD) revert NotHeld();
        bool byArbiter = isArbiter[msg.sender] || msg.sender == owner();
        if (!byArbiter && block.timestamp < e.deadline) revert NotExpired();
        _refund(escrowId, e);
    }

    /// @notice Atomically refund every still-held escrow in a cascade tree to its payer.
    /// @dev    The core §5.4 primitive: a failing downstream hop unwinds the parents that
    ///         already escrowed payment, all-or-nothing within one transaction.
    function unwindCascade(bytes32 cascadeId) external onlyArbiter nonReentrant {
        uint256[] storage ids = cascadeEscrows[cascadeId];
        uint256 total;
        uint256 n;
        uint256 len = ids.length;
        for (uint256 i; i < len; ++i) {
            Escrow storage e = escrows[ids[i]];
            if (e.state == State.HELD) {
                total += e.amount;
                ++n;
                _refund(ids[i], e);
            }
        }
        emit CascadeUnwound(cascadeId, n, total);
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
