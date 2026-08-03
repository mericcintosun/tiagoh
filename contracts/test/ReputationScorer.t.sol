// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReputationScorer} from "../src/ReputationScorer.sol";
import {QualityBond} from "../src/QualityBond.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Reputation aggregation, and the bond cap that is the whole Sybil defence.
contract ReputationScorerTest is Test {
    ReputationScorer internal scorer;
    QualityBond internal bond;
    MockERC20 internal token;

    address internal owner = address(0xA0);
    address internal reporter = address(0x8E);
    address internal arbiter = address(0xAB);
    address internal seller = address(0x5E);
    address internal sybil = address(0x51B);
    address internal buyer = address(0xB0);

    bytes32 internal constant TOOL = keccak256("tool:good");
    bytes32 internal constant OTHER_TOOL = keccak256("tool:bad");
    bytes32 internal constant SYBIL_TOOL = keccak256("tool:sybil");

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        bond = new QualityBond(address(token), owner);
        scorer = new ReputationScorer(address(0), owner);

        vm.startPrank(owner);
        scorer.setReporter(reporter, true);
        scorer.setQualityBond(address(bond));
        bond.setArbiter(arbiter, true);
        vm.stopPrank();

        token.mint(seller, 10_000e6);
        vm.prank(seller);
        token.approve(address(bond), type(uint256).max);
    }

    function _bondSilver(bytes32 toolId) internal {
        vm.prank(seller);
        bond.bond(toolId, QualityBond.Tier.SILVER); // 500e6 → caps score at 500
    }

    // ── aggregation ──────────────────────────────────────────────────────────

    function test_recordSuccess_scoresToolAndSeller() public {
        _bondSilver(TOOL);
        vm.startPrank(reporter);
        scorer.recordSuccess(TOOL, seller, 5e6, true);
        scorer.recordSuccess(TOOL, seller, 5e6, false);
        vm.stopPrank();

        // 2 successes * 10 + 1 unique payer * 5 + 10e6/1e6 volume = 35
        assertEq(scorer.scoreOfTool(TOOL), 35, "tool score");
        assertEq(scorer.scoreOf(seller), 35, "seller score");
    }

    function test_recordDisputeAndSlash_reduceScore() public {
        _bondSilver(TOOL);
        vm.startPrank(reporter);
        scorer.recordSuccess(TOOL, seller, 20e6, true); // 10 + 5 + 20 = 35
        scorer.recordDispute(TOOL, seller); // -25 → 10
        vm.stopPrank();
        assertEq(scorer.scoreOfTool(TOOL), 10, "dispute penalised");

        vm.prank(reporter);
        scorer.recordSlash(TOOL, seller); // -100 → floors at 0
        assertEq(scorer.scoreOfTool(TOOL), 0, "slash floors the score");
    }

    /// @dev Reputation is per tool, so a bad tool cannot hide behind its operator's good ones.
    function test_scoreIsPerTool_notJustPerOperator() public {
        _bondSilver(TOOL);
        _bondSilver(OTHER_TOOL);

        vm.startPrank(reporter);
        scorer.recordSuccess(TOOL, seller, 10e6, true); // good tool
        scorer.recordDispute(OTHER_TOOL, seller); // bad tool
        vm.stopPrank();

        assertEq(scorer.scoreOfTool(TOOL), 25, "good tool unaffected");
        assertEq(scorer.scoreOfTool(OTHER_TOOL), 0, "bad tool penalised on its own");
    }

    function test_onlyReporterMayWrite() public {
        vm.expectRevert(ReputationScorer.NotReporter.selector);
        scorer.recordSuccess(TOOL, seller, 1e6, true);
    }

    /// @dev Reputation decides who gets paid, so the owner key must not be able to mint it.
    function test_ownerIsNotImplicitlyReporter() public {
        vm.prank(owner);
        vm.expectRevert(ReputationScorer.NotReporter.selector);
        scorer.recordSuccess(TOOL, seller, 1e6, true);
    }

    // ── the bond cap: Sybil + wash-trading + whitewashing ────────────────────

    /// @dev THE Sybil defence. Gas is effectively free on GOAT, so an uncapped score can be
    ///      farmed for wei. A fresh address with no collateral must score zero however much
    ///      volume it fabricates.
    function test_unbondedSybilScoresZeroHoweverMuchItFarms() public {
        vm.startPrank(reporter);
        for (uint256 i; i < 50; ++i) {
            scorer.recordSuccess(SYBIL_TOOL, sybil, 1_000e6, true);
        }
        vm.stopPrank();

        assertGt(scorer.rawScore(_toolSignals(SYBIL_TOOL)), 50_000, "raw farm is large");
        assertEq(scorer.scoreOfTool(SYBIL_TOOL), 0, "but uncollateralized score is zero");
    }

    /// @dev Wash trading cannot lift a tool above what its operator has actually staked.
    function test_washTradingIsCappedByTheLiveBond() public {
        _bondSilver(TOOL); // 500e6 bond → cap 500 points

        vm.startPrank(reporter);
        for (uint256 i; i < 200; ++i) {
            scorer.recordSuccess(TOOL, seller, 100e6, true); // self-dealing volume + fake payers
        }
        vm.stopPrank();

        assertGt(scorer.rawScore(_toolSignals(TOOL)), 500, "raw score exceeds the cap");
        assertEq(scorer.scoreOfTool(TOOL), 500, "capped at the staked amount");
    }

    /// @dev A slash lowers the live bond, which lowers the cap — punishment bites immediately,
    ///      not only through the dispute counter.
    function test_slashImmediatelyLowersTheScoreCap() public {
        _bondSilver(TOOL);
        vm.startPrank(reporter);
        for (uint256 i; i < 200; ++i) {
            scorer.recordSuccess(TOOL, seller, 100e6, true);
        }
        vm.stopPrank();
        assertEq(scorer.scoreOfTool(TOOL), 500, "at the cap");

        vm.prank(arbiter);
        bond.slash(TOOL, 400e6, buyer); // 100e6 left

        assertEq(scorer.scoreOfTool(TOOL), 100, "cap follows the live bond down");
    }

    /// @dev Whitewashing: abandoning a slashed identity means abandoning the stake that gave it
    ///      any score, so the fresh identity starts at zero score AND zero collateral.
    function test_whitewashingCostsAFullNewBond() public {
        _bondSilver(TOOL);
        vm.prank(reporter);
        scorer.recordSuccess(TOOL, seller, 100e6, true);
        vm.prank(arbiter);
        bond.slash(TOOL, 500e6, buyer); // slashed to nothing

        assertEq(scorer.scoreOfTool(TOOL), 0, "slashed identity has no standing");

        // The fresh identity has history-free signals but no bond, so still no standing.
        vm.startPrank(reporter);
        scorer.recordSuccess(SYBIL_TOOL, sybil, 100e6, true);
        vm.stopPrank();
        assertEq(scorer.scoreOfTool(SYBIL_TOOL), 0, "fresh identity must re-stake to score");
    }

    /// @dev Restoring collateral restores standing — the incentive we want, versus abandoning.
    function test_topUpRestoresScoringCapacity() public {
        _bondSilver(TOOL);
        vm.prank(reporter);
        scorer.recordSuccess(TOOL, seller, 100e6, true); // raw 115
        vm.prank(arbiter);
        bond.slash(TOOL, 500e6, buyer);
        assertEq(scorer.scoreOfTool(TOOL), 0, "no collateral, no score");

        vm.prank(seller);
        bond.topUp(TOOL, 50e6);
        assertEq(scorer.scoreOfTool(TOOL), 50, "capped by the restored bond");
    }

    /// @dev The auction ranks by an operator score capped by the tool's bond, so a bidder
    ///      cannot bring reputation earned elsewhere to an uncollateralized bid.
    function test_scoreOfSeller_isCappedByTheToolsBond() public {
        _bondSilver(TOOL);
        vm.startPrank(reporter);
        for (uint256 i; i < 100; ++i) {
            scorer.recordSuccess(TOOL, seller, 100e6, true);
        }
        vm.stopPrank();

        assertEq(scorer.scoreOfSeller(seller, TOOL), 500, "capped by the bonded tool");
        assertEq(scorer.scoreOfSeller(seller, SYBIL_TOOL), 0, "no bond on that tool, no score");
    }

    function _toolSignals(bytes32 toolId) internal view returns (ReputationScorer.Signals memory) {
        (
            uint256 volume,
            uint256 successes,
            uint256 uniquePayers,
            uint256 disputes,
            uint256 slashes
        ) = scorer.toolSignals(toolId);
        return ReputationScorer.Signals({
            volume: volume,
            successes: successes,
            uniquePayers: uniquePayers,
            disputes: disputes,
            slashes: slashes
        });
    }
}
