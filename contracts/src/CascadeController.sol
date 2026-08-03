// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CascadeController
/// @notice Budget-bounded cascading payments (PRD §5.3). A buyer opens a cascade with a single
///         root deposit that caps the *entire* recursive call tree; every hop is checked against
///         the remaining budget and rejected on-chain if it would exceed it. A configurable
///         share of a child hop's amount is attributed *up* to its parent hop's payee (recursive
///         revenue attribution). `close` refunds the unspent remainder to the opener.
///
/// @dev    DELEGATED SUB-BUDGETS — how "an agent hires an agent" actually works on-chain.
///
///         Only the opener could previously pay hops, which meant the buyer had to know and
///         drive the whole tree up front. That contradicts the entire premise: a paid tool
///         discovers *at runtime* which sub-tools it needs.
///
///         Simply letting any downstream payee spend the pool would be worse — a single
///         malicious sub-tool could drain the remaining budget to itself. So spending rights are
///         explicit and capped: every participant holds an `allowance` out of the cascade, the
///         opener starts with all of it, and `delegate` hands a bounded slice down the tree.
///         A hop spends from the caller's own allowance, so the blast radius of any participant
///         is exactly what its parent chose to delegate — capped, sub-delegatable, auditable.
///
///         Allowances are spending rights, not transfers: the tokens stay in this contract until
///         a hop is actually paid, and `close` returns everything unspent to the opener.
///
///         EXPIRY. A cascade now has a deadline. After it, hops are refused and *anyone* may
///         `close` it, which always refunds the opener. Previously only the opener could close
///         and there was no deadline, so an opener that went away locked the remainder forever.
contract CascadeController is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_DURATION = 365 days;

    struct Cascade {
        address opener;
        uint64 expiry;
        bool open;
        IERC20 token;
        uint256 budget;
        uint256 spent;
        uint256 hopCount;
    }

    struct Hop {
        uint256 parentHopId;
        address payee;
        uint256 amount;
        uint256 attributionBps;
    }

    uint256 public cascadeCount;
    mapping(uint256 => Cascade) public cascades;
    /// @dev cascadeId => hopId => Hop  (hopId 0 is reserved as "root / no parent")
    mapping(uint256 => mapping(uint256 => Hop)) public hops;
    /// @dev cascadeId => participant => remaining spending right out of the cascade budget
    mapping(uint256 => mapping(address => uint256)) public allowance;
    /// @notice Guarded-launch cap: max budget a single cascade may lock (0 = unlimited).
    uint256 public maxBudget;

    error ZeroBudget();
    error ExceedsCap();
    error NotOpener();
    error CascadeIsClosed();
    error CascadeExpired();
    error CascadeNotExpired();
    error BudgetExceeded(uint256 cascadeId, uint256 remaining, uint256 requested);
    error AllowanceExceeded(uint256 cascadeId, uint256 remaining, uint256 requested);
    error InvalidParentHop();
    error InvalidAttribution();
    error ZeroPayee();
    error ZeroDuration();
    error DurationTooLong();

    event CascadeOpened(
        uint256 indexed cascadeId,
        address indexed opener,
        address token,
        uint256 budget,
        uint64 expiry
    );
    event Delegated(
        uint256 indexed cascadeId, address indexed from, address indexed to, uint256 amount
    );
    event HopPaid(
        uint256 indexed cascadeId,
        uint256 indexed hopId,
        uint256 indexed parentHopId,
        address payee,
        uint256 amount,
        uint256 attributionToParent
    );
    event CascadeClosed(uint256 indexed cascadeId, uint256 refunded);
    event MaxBudgetSet(uint256 maxBudget);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Set the per-cascade budget cap (0 = unlimited). Guarded-launch control.
    function setMaxBudget(uint256 cap) external onlyOwner {
        maxBudget = cap;
        emit MaxBudgetSet(cap);
    }

    /// @notice Open a cascade; pulls `budget` of `token` from the caller as the tree cap and
    ///         grants the caller the full spending right over it.
    /// @param duration How long hops may be paid before the cascade can be wound down.
    function openCascade(address token, uint256 budget, uint256 duration)
        external
        nonReentrant
        returns (uint256 cascadeId)
    {
        if (budget == 0) revert ZeroBudget();
        if (maxBudget != 0 && budget > maxBudget) revert ExceedsCap();
        if (duration == 0) revert ZeroDuration();
        if (duration > MAX_DURATION) revert DurationTooLong();

        // Book the amount actually received (fee-on-transfer / rebasing safe), so a hop can
        // never be paid out against budget the contract does not hold.
        IERC20 t = IERC20(token);
        uint256 balBefore = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), budget);
        uint256 received = t.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroBudget();
        if (maxBudget != 0 && received > maxBudget) revert ExceedsCap();

        uint64 expiry = uint64(block.timestamp + duration);
        cascadeId = ++cascadeCount;
        cascades[cascadeId] = Cascade({
            opener: msg.sender,
            expiry: expiry,
            open: true,
            token: t,
            budget: received,
            spent: 0,
            hopCount: 0
        });
        allowance[cascadeId][msg.sender] = received;
        emit CascadeOpened(cascadeId, msg.sender, token, received, expiry);
    }

    /// @notice Hand a bounded slice of your own spending right to another participant. This is
    ///         how a paid tool is authorized to hire sub-tools out of the same budget, and it
    ///         sub-delegates to any depth: the recipient can `delegate` onward from what it
    ///         holds, never more.
    function delegate(uint256 cascadeId, address to, uint256 amount) external {
        Cascade storage c = cascades[cascadeId];
        if (!c.open) revert CascadeIsClosed();
        if (block.timestamp > c.expiry) revert CascadeExpired();
        if (to == address(0)) revert ZeroPayee();

        uint256 rem = allowance[cascadeId][msg.sender];
        if (amount > rem) revert AllowanceExceeded(cascadeId, rem, amount);

        allowance[cascadeId][msg.sender] = rem - amount;
        allowance[cascadeId][to] += amount;
        emit Delegated(cascadeId, msg.sender, to, amount);
    }

    /// @notice Pay a hop within a cascade, spending from the caller's own allowance.
    /// @param parentHopId    0 for a root hop, else the paying parent hop.
    /// @param attributionBps Share of `amount` routed up to the parent hop's payee.
    function payHop(
        uint256 cascadeId,
        uint256 parentHopId,
        address payee,
        uint256 amount,
        uint256 attributionBps
    ) external nonReentrant returns (uint256 hopId) {
        Cascade storage c = cascades[cascadeId];
        if (!c.open) revert CascadeIsClosed();
        if (block.timestamp > c.expiry) revert CascadeExpired();
        if (payee == address(0)) revert ZeroPayee();
        if (attributionBps > BPS) revert InvalidAttribution();

        uint256 rem = allowance[cascadeId][msg.sender];
        if (amount > rem) revert AllowanceExceeded(cascadeId, rem, amount);

        // Defence in depth: the allowance accounting already implies this, but the tree-wide cap
        // is the invariant the whole design promises, so it is checked directly too.
        uint256 budgetLeft = c.budget - c.spent;
        if (amount > budgetLeft) revert BudgetExceeded(cascadeId, budgetLeft, amount);

        uint256 attribution;
        address parentPayee;
        if (parentHopId != 0) {
            Hop storage p = hops[cascadeId][parentHopId];
            if (p.payee == address(0)) revert InvalidParentHop();
            parentPayee = p.payee;
            attribution = (amount * attributionBps) / BPS;
        }

        allowance[cascadeId][msg.sender] = rem - amount;
        c.spent += amount;
        hopId = ++c.hopCount;
        hops[cascadeId][hopId] = Hop({
            parentHopId: parentHopId, payee: payee, amount: amount, attributionBps: attributionBps
        });

        if (attribution > 0) {
            c.token.safeTransfer(parentPayee, attribution);
        }
        c.token.safeTransfer(payee, amount - attribution);

        emit HopPaid(cascadeId, hopId, parentHopId, payee, amount, attribution);
    }

    /// @notice Close a cascade and refund the unspent remainder to the opener. The opener may
    ///         close at any time; once the cascade has expired **anyone** may close it, so an
    ///         absent opener can never strand the remainder. The refund always goes to the
    ///         opener, so a permissionless close cannot redirect value.
    function close(uint256 cascadeId) external nonReentrant {
        Cascade storage c = cascades[cascadeId];
        if (!c.open) revert CascadeIsClosed();
        if (msg.sender != c.opener && block.timestamp <= c.expiry) revert CascadeNotExpired();

        c.open = false;
        uint256 refund = c.budget - c.spent;
        if (refund > 0) {
            c.token.safeTransfer(c.opener, refund);
        }
        emit CascadeClosed(cascadeId, refund);
    }

    function remainingBudget(uint256 cascadeId) external view returns (uint256) {
        Cascade storage c = cascades[cascadeId];
        return c.budget - c.spent;
    }

    /// @notice Explicit accessor so consumers never depend on the packed struct's field order.
    function cascadeState(uint256 cascadeId)
        external
        view
        returns (uint256 budget, uint256 spent, uint256 hopCount, uint64 expiry, bool open)
    {
        Cascade storage c = cascades[cascadeId];
        return (c.budget, c.spent, c.hopCount, c.expiry, c.open);
    }
}
