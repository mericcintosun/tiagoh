// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BitVM2Arbiter} from "../src/BitVM2Arbiter.sol";

/// @title ConfigureArbiter
/// @notice Wires the BitVM2Arbiter's real verifier + proposer stake and (only then) explains the
///         authorization step. This deliberately does NOT grant the arbiter `isArbiter` on
///         QualityBond/EscrowVault — that is a separate, manual governance action to take only
///         after the REAL bidirectional BitVM2 verifier is live (see docs/SECURITY.md). Until
///         then, the permissioned DisputeArbiter is the authorized arbiter.
///
/// @dev    Env:
///           BITVM2_ARBITER_ADDRESS   the deployed BitVM2Arbiter
///           BITVM2_VERIFIER_ADDRESS  GOAT's real fraud-proof verifier (REQUIRED, non-zero)
///           PROPOSAL_BOND            stake required to propose (default 1000e6)
///           CHALLENGE_WINDOW         seconds, >= 1 hour (default 1 days)
contract ConfigureArbiter is Script {
    function run() external {
        BitVM2Arbiter arb = BitVM2Arbiter(vm.envAddress("BITVM2_ARBITER_ADDRESS"));
        address verifier = vm.envAddress("BITVM2_VERIFIER_ADDRESS");
        require(verifier != address(0), "verifier must be the real BitVM2 node, not a stub");
        uint256 bond = vm.envOr("PROPOSAL_BOND", uint256(1000e6));
        uint256 window = vm.envOr("CHALLENGE_WINDOW", uint256(1 days));

        vm.startBroadcast();
        arb.setVerifier(verifier);
        arb.setProposalBond(bond);
        arb.setChallengeWindow(window);
        vm.stopBroadcast();

        console2.log("BitVM2Arbiter configured:", address(arb));
        console2.log("  verifier", verifier);
        console2.log("  proposalBond", bond);
        console2.log("  challengeWindow", window);
        console2.log("NOTE: authorize on QualityBond/EscrowVault only after verifier is proven.");
    }
}
