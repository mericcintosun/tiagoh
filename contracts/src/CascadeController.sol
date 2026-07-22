// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CascadeController
/// @notice Budget-bounded cascading payments (PRD §5.3). A buyer opens a cascade with a
///         single root deposit that caps the *entire* recursive call tree; every hop is
///         checked against the remaining budget and rejected on-chain if it would exceed
///         it. A configurable share of a child hop's amount is attributed *up* to its
///         parent hop's payee (recursive revenue attribution). `close` refunds the unspent
///         remainder to the opener.
/// @dev    Attribution flows one level per hop; because each hop attributes to its parent,
///         value propagates up the tree hop-by-hop. TODO(prod): compounding multi-level
///         attribution policies and per-hop `parentId` receipt anchoring live off-chain in
///         the gateway; wire them through ReceiptRegistry.
contract CascadeController is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    struct Cascade {
        address opener;
        IERC20 token;
        uint256 budget;
        uint256 spent;
        uint256 hopCount;
        bool open;
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

    error ZeroBudget();
    error NotOpener();
    error CascadeIsClosed();
    error BudgetExceeded(uint256 cascadeId, uint256 remaining, uint256 requested);
    error InvalidParentHop();
    error InvalidAttribution();
    error ZeroPayee();

    event CascadeOpened(
        uint256 indexed cascadeId, address indexed opener, address token, uint256 budget
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

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Open a cascade; pulls `budget` of `token` from the caller as the tree cap.
    function openCascade(address token, uint256 budget)
        external
        nonReentrant
        returns (uint256 cascadeId)
    {
        if (budget == 0) revert ZeroBudget();
        // Book the amount actually received (fee-on-transfer / rebasing safe), so a hop can
        // never be paid out against budget the contract does not hold.
        IERC20 t = IERC20(token);
        uint256 balBefore = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), budget);
        uint256 received = t.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroBudget();

        cascadeId = ++cascadeCount;
        cascades[cascadeId] = Cascade({
            opener: msg.sender,
            token: t,
            budget: received,
            spent: 0,
            hopCount: 0,
            open: true
        });
        emit CascadeOpened(cascadeId, msg.sender, token, received);
    }

    /// @notice Pay a hop within a cascade.
    /// @param parentHopId  0 for a root hop, else the paying parent hop.
    /// @param attributionBps  Share of `amount` routed up to the parent hop's payee.
    function payHop(
        uint256 cascadeId,
        uint256 parentHopId,
        address payee,
        uint256 amount,
        uint256 attributionBps
    ) external nonReentrant returns (uint256 hopId) {
        Cascade storage c = cascades[cascadeId];
        if (!c.open) revert CascadeIsClosed();
        if (msg.sender != c.opener) revert NotOpener();
        if (payee == address(0)) revert ZeroPayee();
        if (attributionBps > BPS) revert InvalidAttribution();

        uint256 remaining = c.budget - c.spent;
        if (amount > remaining) revert BudgetExceeded(cascadeId, remaining, amount);

        uint256 attribution;
        address parentPayee;
        if (parentHopId != 0) {
            Hop storage p = hops[cascadeId][parentHopId];
            if (p.payee == address(0)) revert InvalidParentHop();
            parentPayee = p.payee;
            attribution = (amount * attributionBps) / BPS;
        }

        c.spent += amount;
        hopId = ++c.hopCount;
        hops[cascadeId][hopId] = Hop({
            parentHopId: parentHopId,
            payee: payee,
            amount: amount,
            attributionBps: attributionBps
        });

        if (attribution > 0) {
            c.token.safeTransfer(parentPayee, attribution);
        }
        c.token.safeTransfer(payee, amount - attribution);

        emit HopPaid(cascadeId, hopId, parentHopId, payee, amount, attribution);
    }

    /// @notice Close a cascade and refund the unspent remainder to the opener.
    function close(uint256 cascadeId) external nonReentrant {
        Cascade storage c = cascades[cascadeId];
        if (!c.open) revert CascadeIsClosed();
        if (msg.sender != c.opener) revert NotOpener();

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
}
