// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title QualityBond
/// @notice Staked quality bonds / SLA insurance for paid tools (PRD §5.2). A seller stakes a
///         tiered bond against a tool; it is locked while the tool is active. An authorized
///         arbiter (the DisputeArbiter) can `slash` the bond and route the slashed amount to the
///         harmed buyer as an auto-refund. The seller may unbond after a cooldown.
///
/// @dev    ANTI-WHITEWASHING. Reputation alone cannot punish a bad seller on a chain where a
///         fresh address is free: get slashed, abandon the identity, start again at zero. The
///         bond is what makes that expensive, so three things protect it:
///
///         1. `totalSlashed` is **permanent per seller address** and survives `withdraw`, so a
///            slash is a durable public fact rather than something that disappears with the bond.
///         2. A slash starts a `slashCooldown` during which the remaining stake cannot be
///            withdrawn. Without it, a seller could watch a dispute land and yank the rest of
///            their bond in the same block, leaving nothing for the next victim.
///         3. `ReputationScorer` caps a tool's score by its **live** bond, so abandoning a
///            slashed identity means abandoning the stake that gave it any score at all — and a
///            slash immediately lowers the cap. Whitewashing costs a full new bond.
///
///         `topUp` exists because of (3): after a slash a seller must be able to restore their
///         collateral to regain standing, rather than being forced to abandon the identity —
///         which is precisely the behaviour we do not want to incentivize.
contract QualityBond is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint256 public cooldown = 7 days;
    /// @notice Extra lock applied from the moment of a slash, so a caught seller cannot
    ///         immediately withdraw what is left of their collateral.
    uint256 public slashCooldown = 30 days;

    enum Tier {
        NONE,
        BRONZE,
        SILVER,
        GOLD
    }

    struct Bond {
        address seller;
        uint256 amount;
        Tier tier;
        bool active; // true while locked; false once unbonding started
        uint256 unlockAt; // timestamp withdrawal becomes available
    }

    /// @dev toolId => Bond
    mapping(bytes32 => Bond) public bonds;
    /// @dev toolId => timestamp before which a slashed bond cannot be withdrawn
    mapping(bytes32 => uint256) public slashLockedUntil;
    /// @dev tier => required stake
    mapping(Tier => uint256) public tierAmount;
    /// @dev authorized slashers (DisputeArbiter)
    mapping(address => bool) public isArbiter;
    /// @notice Permanent, per-address record of everything a seller has ever been slashed for.
    ///         Survives unbonding, so an identity cannot shed its history by cycling bonds.
    mapping(address => uint256) public totalSlashed;
    /// @notice Permanent count of slash events per seller address.
    mapping(address => uint256) public slashCount;

    error NotArbiter();
    error AlreadyBonded();
    error NotSeller();
    error NoBond();
    error InvalidTier();
    error AlreadyUnbonding();
    error StillLocked();
    error CooldownNotElapsed();
    error SlashCooldownNotElapsed();
    error SlashExceedsBond();
    error ZeroAddress();
    error ZeroAmount();

    event TierSet(Tier indexed tier, uint256 amount);
    event ArbiterSet(address indexed arbiter, bool allowed);
    event CooldownSet(uint256 cooldown, uint256 slashCooldown);
    event Bonded(bytes32 indexed toolId, address indexed seller, Tier tier, uint256 amount);
    event ToppedUp(bytes32 indexed toolId, address indexed seller, uint256 amount, uint256 total);
    event Slashed(
        bytes32 indexed toolId,
        address indexed to,
        uint256 amount,
        uint256 remaining,
        uint256 lockedUntil
    );
    event UnbondStarted(bytes32 indexed toolId, uint256 unlockAt);
    event Withdrawn(bytes32 indexed toolId, address indexed seller, uint256 amount);

    constructor(address token_, address initialOwner) Ownable(initialOwner) {
        token = IERC20(token_);
        // Default tiers assume a 6-decimal (USDC-style) payment token.
        tierAmount[Tier.BRONZE] = 100e6;
        tierAmount[Tier.SILVER] = 500e6;
        tierAmount[Tier.GOLD] = 2000e6;
    }

    /// @dev Least privilege: the owner is NOT implicitly a slasher. Only addresses explicitly
    ///      granted via `setArbiter` (the DisputeArbiter contract) may slash, so a compromised
    ///      owner key cannot drain bonds directly — it can only (re)assign the arbiter, which a
    ///      timelock makes observable. This closes the "owner drains all bond TVL" path.
    modifier onlyArbiter() {
        if (!isArbiter[msg.sender]) revert NotArbiter();
        _;
    }

    function setTier(Tier tier, uint256 amount) external onlyOwner {
        if (tier == Tier.NONE) revert InvalidTier();
        tierAmount[tier] = amount;
        emit TierSet(tier, amount);
    }

    function setArbiter(address arbiter, bool allowed) external onlyOwner {
        isArbiter[arbiter] = allowed;
        emit ArbiterSet(arbiter, allowed);
    }

    function setCooldowns(uint256 cooldown_, uint256 slashCooldown_) external onlyOwner {
        cooldown = cooldown_;
        slashCooldown = slashCooldown_;
        emit CooldownSet(cooldown_, slashCooldown_);
    }

    /// @notice Seller stakes a bond of `tier` against `toolId`.
    /// @dev    Keyed on `seller`, not `amount`: a bond slashed to zero is still occupied by its
    ///         original seller until they `startUnbond` + `withdraw` (which deletes it). This
    ///         stops a griefer from hijacking a tool's bond slot the instant it is slashed to 0.
    function bond(bytes32 toolId, Tier tier) external nonReentrant {
        if (tier == Tier.NONE) revert InvalidTier();
        Bond storage b = bonds[toolId];
        if (b.seller != address(0)) revert AlreadyBonded();

        uint256 amt = tierAmount[tier];
        if (amt == 0) revert InvalidTier();

        bonds[toolId] =
            Bond({seller: msg.sender, amount: amt, tier: tier, active: true, unlockAt: 0});
        token.safeTransferFrom(msg.sender, address(this), amt);
        emit Bonded(toolId, msg.sender, tier, amt);
    }

    /// @notice Restore collateral to a bond (typically after a slash). Only the bond's own
    ///         seller may top up, and only while the bond is still active — an unbonding bond is
    ///         on its way out and must not be re-collateralized to dodge the cooldown.
    function topUp(bytes32 toolId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Bond storage b = bonds[toolId];
        if (b.seller != msg.sender) revert NotSeller();
        if (!b.active) revert AlreadyUnbonding();

        b.amount += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ToppedUp(toolId, msg.sender, amount, b.amount);
    }

    /// @notice Arbiter slashes `amount` from a tool's bond to `to` (the refunded buyer).
    /// @dev    Also starts `slashCooldown`, so the remainder cannot be withdrawn immediately
    ///         after a seller sees a ruling go against them.
    function slash(bytes32 toolId, uint256 amount, address to) external onlyArbiter nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        Bond storage b = bonds[toolId];
        if (b.amount == 0) revert NoBond();
        if (amount > b.amount) revert SlashExceedsBond();

        b.amount -= amount;
        uint256 lockedUntil = block.timestamp + slashCooldown;
        slashLockedUntil[toolId] = lockedUntil;

        // Permanent per-identity history: cycling the bond does not erase it.
        totalSlashed[b.seller] += amount;
        slashCount[b.seller] += 1;

        token.safeTransfer(to, amount);
        emit Slashed(toolId, to, amount, b.amount, lockedUntil);
    }

    /// @notice Seller begins unbonding; starts the withdrawal cooldown.
    function startUnbond(bytes32 toolId) external {
        Bond storage b = bonds[toolId];
        if (b.seller != msg.sender) revert NotSeller();
        if (!b.active) revert AlreadyUnbonding();

        b.active = false;
        b.unlockAt = block.timestamp + cooldown;
        emit UnbondStarted(toolId, b.unlockAt);
    }

    /// @notice Seller withdraws the remaining bond after both cooldowns have elapsed.
    function withdraw(bytes32 toolId) external nonReentrant {
        Bond storage b = bonds[toolId];
        if (b.seller != msg.sender) revert NotSeller();
        if (b.active) revert StillLocked();
        if (block.timestamp < b.unlockAt) revert CooldownNotElapsed();
        if (block.timestamp < slashLockedUntil[toolId]) revert SlashCooldownNotElapsed();

        uint256 amt = b.amount;
        delete bonds[toolId];
        delete slashLockedUntil[toolId];
        if (amt > 0) {
            token.safeTransfer(msg.sender, amt);
        }
        emit Withdrawn(toolId, msg.sender, amt);
    }

    /// @notice Current staked amount for a tool (a trust signal at payment time, and the cap
    ///         `ReputationScorer` applies to that tool's score).
    function bondAmount(bytes32 toolId) external view returns (uint256) {
        return bonds[toolId].amount;
    }

    /// @notice Earliest timestamp the remaining bond can be withdrawn, accounting for both the
    ///         normal unbonding cooldown and any post-slash lock.
    function withdrawableAt(bytes32 toolId) external view returns (uint256) {
        Bond storage b = bonds[toolId];
        uint256 slashLock = slashLockedUntil[toolId];
        return b.unlockAt > slashLock ? b.unlockAt : slashLock;
    }
}
