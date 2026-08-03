// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";
import {IQualityBondSlasher} from "./interfaces/IRecourse.sol";

/// @title ReputationScorer
/// @notice Aggregates a portable trust score from recorded settlement outcomes (PRD §5.1).
///         The canonical ERC-8004 Reputation Registry on GOAT stores raw signed signals but
///         does no scoring; this contract layers aggregation on top.
///
/// @dev    THE SYBIL PROBLEM, AND HOW THIS BOUNDS IT.
///
///         An unbounded `successes * w` score is free to farm on a chain where gas is
///         effectively free: a seller pays themselves from throwaway addresses and mints
///         reputation for the cost of a few wei. Worse, a slashed seller can simply abandon
///         the address and start again at zero — and because a score floors at zero,
///         *whitewashing is strictly profitable* for a bad actor.
///
///         The fix is to make reputation cost capital rather than transactions: a subject's
///         score is **capped by its live quality bond**. Concretely,
///         `score = min(rawScore, liveBond / bondScoreDivisor)`. That single lever bounds every
///         farming vector at once —
///           - wash trading cannot lift a subject above what it has staked;
///           - a fresh Sybil address has no bond, so it scores zero however much volume it
///             fabricates;
///           - abandoning a slashed identity means abandoning (and re-posting) the bond, so
///             whitewashing costs the full stake instead of being free;
///           - a slash lowers the bond, which lowers the cap, so punishment bites immediately
///             and not just via the dispute counter.
///
///         Signals are written by authorized reporters (the gateway) and by the DisputeArbiter.
///         Reporters MUST only report outcomes backed by a **co-signed** receipt — a receipt the
///         seller's own gateway wrote unilaterally proves nothing. See `ReceiptRegistry`.
///
///         UNITS: `volume` is denominated in the payment token's minor units (e.g. 1e6 = one
///         USDC-style unit), and `volumeDivisor` is expressed in those same units. Every writer
///         must use one denomination; mixing cents and 6-decimal units silently shifts scores by
///         four orders of magnitude.
contract ReputationScorer is Ownable2Step {
    struct Signals {
        uint256 volume; // cumulative settled volume, payment-token minor units
        uint256 successes; // successful settled calls
        uint256 uniquePayers; // distinct paying agents
        uint256 disputes; // disputes lost
        uint256 slashes; // bond slash events
    }

    /// @dev toolId => aggregated signals (the canonical subject: reputation is per tool, so a
    ///      bad tool cannot hide behind its operator's good ones)
    mapping(bytes32 => Signals) public toolSignals;
    /// @dev seller address => aggregated signals across all their tools
    mapping(address => Signals) public signals;
    /// @dev authorized signal reporters (gateway, DisputeArbiter)
    mapping(address => bool) public isReporter;

    /// @notice Canonical ERC-8004 Reputation Registry on GOAT (raw signal source).
    address public reputationRegistry;
    /// @notice Live bond source used to cap scores. Unset (address(0)) disables the cap —
    ///         acceptable on testnet, never on mainnet.
    IQualityBondSlasher public qualityBond;

    // Scoring weights (governable; published as part of the tiagoh spec).
    uint256 public successWeight = 10;
    uint256 public payerWeight = 5;
    uint256 public volumeDivisor = 1e6; // 1 point per whole unit of a 6-decimal token
    uint256 public disputePenalty = 25;
    uint256 public slashPenalty = 100;
    /// @notice Bond required per point of score. With a 6-decimal token, 1e6 means "one unit of
    ///         stake buys one point", so a $500 bond caps a tool at 500 points.
    uint256 public bondScoreDivisor = 1e6;

    error NotReporter();
    error ZeroDivisor();

    event ReporterSet(address indexed reporter, bool allowed);
    event ReputationRegistrySet(address indexed registry);
    event QualityBondSet(address indexed qualityBond);
    event WeightsSet(
        uint256 successWeight,
        uint256 payerWeight,
        uint256 volumeDivisor,
        uint256 disputePenalty,
        uint256 slashPenalty
    );
    event BondScoreDivisorSet(uint256 divisor);
    event SignalRecorded(
        bytes32 indexed toolId, address indexed seller, string kind, uint256 value
    );

    constructor(address reputationRegistry_, address initialOwner) Ownable(initialOwner) {
        reputationRegistry = reputationRegistry_;
        emit ReputationRegistrySet(reputationRegistry_);
    }

    /// @dev Least privilege: the owner is NOT implicitly a reporter. Reputation drives who gets
    ///      paid (the auction reads it), so the owner key must not be able to mint it.
    modifier onlyReporter() {
        if (!isReporter[msg.sender]) revert NotReporter();
        _;
    }

    function setReporter(address reporter, bool allowed) external onlyOwner {
        isReporter[reporter] = allowed;
        emit ReporterSet(reporter, allowed);
    }

    function setReputationRegistry(address registry) external onlyOwner {
        reputationRegistry = registry;
        emit ReputationRegistrySet(registry);
    }

    function setQualityBond(address qualityBond_) external onlyOwner {
        qualityBond = IQualityBondSlasher(qualityBond_);
        emit QualityBondSet(qualityBond_);
    }

    function setWeights(
        uint256 successWeight_,
        uint256 payerWeight_,
        uint256 volumeDivisor_,
        uint256 disputePenalty_,
        uint256 slashPenalty_
    ) external onlyOwner {
        if (volumeDivisor_ == 0) revert ZeroDivisor();
        successWeight = successWeight_;
        payerWeight = payerWeight_;
        volumeDivisor = volumeDivisor_;
        disputePenalty = disputePenalty_;
        slashPenalty = slashPenalty_;
        emit WeightsSet(
            successWeight_, payerWeight_, volumeDivisor_, disputePenalty_, slashPenalty_
        );
    }

    function setBondScoreDivisor(uint256 divisor) external onlyOwner {
        if (divisor == 0) revert ZeroDivisor();
        bondScoreDivisor = divisor;
        emit BondScoreDivisorSet(divisor);
    }

    /// @notice Record a settled success against both the tool and its operator.
    /// @param volume Settled amount in the payment token's minor units.
    /// @dev Reporters must only call this for outcomes backed by a co-signed receipt.
    function recordSuccess(bytes32 toolId, address seller, uint256 volume, bool newPayer)
        external
        onlyReporter
    {
        Signals storage t = toolSignals[toolId];
        t.successes += 1;
        t.volume += volume;
        if (newPayer) t.uniquePayers += 1;

        Signals storage s = signals[seller];
        s.successes += 1;
        s.volume += volume;
        if (newPayer) s.uniquePayers += 1;

        emit SignalRecorded(toolId, seller, "success", volume);
    }

    /// @notice Record a lost dispute against a tool and its operator.
    function recordDispute(bytes32 toolId, address seller) external onlyReporter {
        toolSignals[toolId].disputes += 1;
        signals[seller].disputes += 1;
        emit SignalRecorded(toolId, seller, "dispute", 1);
    }

    /// @notice Record a bond slash against a tool and its operator.
    function recordSlash(bytes32 toolId, address seller) external onlyReporter {
        toolSignals[toolId].slashes += 1;
        signals[seller].slashes += 1;
        emit SignalRecorded(toolId, seller, "slash", 1);
    }

    /// @notice Raw, uncapped aggregation. Exposed for transparency; consumers should rank by
    ///         the capped `scoreOfTool` / `scoreOf`, which is what Sybil resistance rests on.
    function rawScore(Signals memory s) public view returns (uint256) {
        // Signal magnitudes (counts / token volume) are far below int256 range, so the int256
        // casts cannot overflow and the final uint256 cast is guarded by `< 0`.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 score = int256(s.successes * successWeight) + int256(s.uniquePayers * payerWeight)
            + int256(s.volume / volumeDivisor) - int256(s.disputes * disputePenalty)
            - int256(s.slashes * slashPenalty);
        // forge-lint: disable-next-line(unsafe-typecast)
        return score < 0 ? 0 : uint256(score);
    }

    /// @notice Bond-capped score for a tool — the number the buyer agent and the reverse auction
    ///         should rank by. Reputation a tool has not collateralized does not count.
    function scoreOfTool(bytes32 toolId) public view returns (uint256) {
        uint256 raw = rawScore(toolSignals[toolId]);
        return _capByBond(raw, toolId);
    }

    /// @notice Bond-capped score for an operator address, aggregated over their tools. Capped by
    ///         the bond of `toolId` when one is supplied; use `scoreOfTool` for per-tool ranking.
    function scoreOf(address subject) public view returns (uint256) {
        return rawScore(signals[subject]);
    }

    /// @notice Operator score capped by a specific tool's live bond. This is the form the
    ///         reverse auction uses, so a bidder cannot bring an unbacked reputation to a bid.
    function scoreOfSeller(address subject, bytes32 toolId) external view returns (uint256) {
        return _capByBond(rawScore(signals[subject]), toolId);
    }

    /// @dev `min(raw, liveBond / bondScoreDivisor)`. With no bond source configured the cap is
    ///      disabled — a testnet-only convenience that MUST be wired before mainnet.
    function _capByBond(uint256 raw, bytes32 toolId) internal view returns (uint256) {
        if (address(qualityBond) == address(0)) return raw;
        uint256 cap = qualityBond.bondAmount(toolId) / bondScoreDivisor;
        return raw > cap ? cap : raw;
    }

    /// @notice Convenience read that follows the stored ERC-8004 registry link.
    function linkedIdentityRegistry() external view returns (address) {
        if (reputationRegistry == address(0)) return address(0);
        return IReputationRegistry(reputationRegistry).getIdentityRegistry();
    }
}
