// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";

/// @title ReputationScorer
/// @notice Aggregates a portable trust score from recorded outcome signals (PRD §5.1).
///         The canonical ERC-8004 Reputation Registry on GOAT stores raw signed signals
///         but does no scoring; this contract layers aggregation on top:
///         score = f(volume, successes, unique payers, disputes, slashes).
///         `scoreOf(subject)` is the on-chain view the explorer / buyer agent ranks by.
/// @dev    Signals are written by authorized reporters (the gateway) and by the
///         DisputeArbiter (disputes/slashes). The linked ERC-8004 registry address is
///         stored so off-chain consumers can cross-reference the credibly-neutral source.
contract ReputationScorer is Ownable2Step {
    struct Signals {
        uint256 volume; // cumulative settled volume
        uint256 successes; // successful settled calls
        uint256 uniquePayers; // distinct paying agents
        uint256 disputes; // disputes lost
        uint256 slashes; // bond slash events
    }

    /// @dev subject (tool or agent) => aggregated signals
    mapping(address => Signals) public signals;
    /// @dev authorized signal reporters (gateway, DisputeArbiter)
    mapping(address => bool) public isReporter;

    /// @notice Canonical ERC-8004 Reputation Registry on GOAT (raw signal source).
    address public reputationRegistry;

    // Scoring weights (governable; published as part of the tiagoh spec).
    uint256 public successWeight = 10;
    uint256 public payerWeight = 5;
    uint256 public volumeDivisor = 1e6; // 1 point per 1 unit of a 6-decimal token
    uint256 public disputePenalty = 25;
    uint256 public slashPenalty = 100;

    error NotReporter();

    event ReporterSet(address indexed reporter, bool allowed);
    event ReputationRegistrySet(address indexed registry);
    event WeightsSet(
        uint256 successWeight,
        uint256 payerWeight,
        uint256 volumeDivisor,
        uint256 disputePenalty,
        uint256 slashPenalty
    );
    event SignalRecorded(address indexed subject, string kind, uint256 value);

    constructor(address reputationRegistry_, address initialOwner) Ownable(initialOwner) {
        reputationRegistry = reputationRegistry_;
        emit ReputationRegistrySet(reputationRegistry_);
    }

    modifier onlyReporter() {
        if (!isReporter[msg.sender] && msg.sender != owner()) revert NotReporter();
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

    function setWeights(
        uint256 successWeight_,
        uint256 payerWeight_,
        uint256 volumeDivisor_,
        uint256 disputePenalty_,
        uint256 slashPenalty_
    ) external onlyOwner {
        require(volumeDivisor_ != 0, "divisor=0");
        successWeight = successWeight_;
        payerWeight = payerWeight_;
        volumeDivisor = volumeDivisor_;
        disputePenalty = disputePenalty_;
        slashPenalty = slashPenalty_;
        emit WeightsSet(successWeight_, payerWeight_, volumeDivisor_, disputePenalty_, slashPenalty_);
    }

    /// @notice Record a settled success and its volume for a subject.
    function recordSuccess(address subject, uint256 volume, bool newPayer) external onlyReporter {
        Signals storage s = signals[subject];
        s.successes += 1;
        s.volume += volume;
        if (newPayer) s.uniquePayers += 1;
        emit SignalRecorded(subject, "success", volume);
    }

    /// @notice Record a lost dispute against a subject.
    function recordDispute(address subject) external onlyReporter {
        signals[subject].disputes += 1;
        emit SignalRecorded(subject, "dispute", 1);
    }

    /// @notice Record a bond slash against a subject.
    function recordSlash(address subject) external onlyReporter {
        signals[subject].slashes += 1;
        emit SignalRecorded(subject, "slash", 1);
    }

    /// @notice Aggregated, floored-at-zero reputation score for a subject.
    /// @dev Signal magnitudes (counts / token volume) are far below int256 range, so the
    ///      int256 casts cannot overflow and the final uint256 cast is guarded by `< 0`.
    function scoreOf(address subject) public view returns (uint256) {
        Signals memory s = signals[subject];
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 score = int256(s.successes * successWeight)
            + int256(s.uniquePayers * payerWeight) + int256(s.volume / volumeDivisor)
            - int256(s.disputes * disputePenalty) - int256(s.slashes * slashPenalty);
        // forge-lint: disable-next-line(unsafe-typecast)
        return score < 0 ? 0 : uint256(score);
    }

    /// @notice Convenience read that follows the stored ERC-8004 registry link.
    function linkedIdentityRegistry() external view returns (address) {
        if (reputationRegistry == address(0)) return address(0);
        return IReputationRegistry(reputationRegistry).getIdentityRegistry();
    }
}
