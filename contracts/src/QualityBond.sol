// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title QualityBond
/// @notice Staked quality bonds / SLA insurance for paid tools (PRD §5.2). A seller
///         stakes a tiered bond against a tool; it is locked while the tool is active.
///         An authorized arbiter (the DisputeArbiter, or a verifier oracle) can `slash`
///         the bond and route the slashed amount to the harmed buyer as an auto-refund.
///         The seller may unbond after a cooldown.
contract QualityBond is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint256 public cooldown = 7 days;

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
    /// @dev tier => required stake
    mapping(Tier => uint256) public tierAmount;
    /// @dev authorized slashers (DisputeArbiter / verifier oracle)
    mapping(address => bool) public isArbiter;

    error NotArbiter();
    error AlreadyBonded();
    error NotSeller();
    error NoBond();
    error InvalidTier();
    error AlreadyUnbonding();
    error StillLocked();
    error CooldownNotElapsed();
    error SlashExceedsBond();

    event TierSet(Tier indexed tier, uint256 amount);
    event ArbiterSet(address indexed arbiter, bool allowed);
    event Bonded(bytes32 indexed toolId, address indexed seller, Tier tier, uint256 amount);
    event Slashed(bytes32 indexed toolId, address indexed to, uint256 amount, uint256 remaining);
    event UnbondStarted(bytes32 indexed toolId, uint256 unlockAt);
    event Withdrawn(bytes32 indexed toolId, address indexed seller, uint256 amount);

    constructor(address token_, address initialOwner) Ownable(initialOwner) {
        token = IERC20(token_);
        // Default tiers assume a 6-decimal (USDC-style) payment token.
        tierAmount[Tier.BRONZE] = 100e6;
        tierAmount[Tier.SILVER] = 500e6;
        tierAmount[Tier.GOLD] = 2000e6;
    }

    modifier onlyArbiter() {
        if (!isArbiter[msg.sender] && msg.sender != owner()) revert NotArbiter();
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

    function setCooldown(uint256 cooldown_) external onlyOwner {
        cooldown = cooldown_;
    }

    /// @notice Seller stakes a bond of `tier` against `toolId`.
    function bond(bytes32 toolId, Tier tier) external nonReentrant {
        if (tier == Tier.NONE) revert InvalidTier();
        Bond storage b = bonds[toolId];
        if (b.amount != 0) revert AlreadyBonded();

        uint256 amt = tierAmount[tier];
        if (amt == 0) revert InvalidTier();

        bonds[toolId] =
            Bond({seller: msg.sender, amount: amt, tier: tier, active: true, unlockAt: 0});
        token.safeTransferFrom(msg.sender, address(this), amt);
        emit Bonded(toolId, msg.sender, tier, amt);
    }

    /// @notice Arbiter slashes `amount` from a tool's bond to `to` (the refunded buyer).
    function slash(bytes32 toolId, uint256 amount, address to) external onlyArbiter nonReentrant {
        Bond storage b = bonds[toolId];
        if (b.amount == 0) revert NoBond();
        if (amount > b.amount) revert SlashExceedsBond();

        b.amount -= amount;
        token.safeTransfer(to, amount);
        emit Slashed(toolId, to, amount, b.amount);
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

    /// @notice Seller withdraws the remaining bond after cooldown.
    function withdraw(bytes32 toolId) external nonReentrant {
        Bond storage b = bonds[toolId];
        if (b.seller != msg.sender) revert NotSeller();
        if (b.active) revert StillLocked();
        if (block.timestamp < b.unlockAt) revert CooldownNotElapsed();

        uint256 amt = b.amount;
        delete bonds[toolId];
        if (amt > 0) {
            token.safeTransfer(msg.sender, amt);
        }
        emit Withdrawn(toolId, msg.sender, amt);
    }

    /// @notice Current staked amount for a tool (a trust signal at payment time).
    function bondAmount(bytes32 toolId) external view returns (uint256) {
        return bonds[toolId].amount;
    }
}
