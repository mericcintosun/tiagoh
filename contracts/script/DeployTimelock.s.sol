// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title DeployTimelock
/// @notice Deploys an OpenZeppelin TimelockController to become the owner of the tiagoh
///         contracts on mainnet. Governance flow: a Safe multisig is PROPOSER + CANCELLER and
///         the timelock enforces a `MIN_DELAY` before any privileged call (setArbiter,
///         setWeights, setVerifier, …) executes, so bond/escrow authority changes are public
///         and delayed — no single key can rug the system.
///
/// @dev    Env:
///           MIN_DELAY   seconds (default 2 days)
///           PROPOSERS   comma-separated addresses (the Safe multisig) — set via --sig or edit
///           EXECUTORS   comma-separated (use address(0) for "anyone can execute after delay")
///         After deploy, run TransferOwnership.s.sol pointing GOVERNANCE at this timelock, then
///         have the Safe call `acceptOwnership()` on each contract through the timelock.
contract DeployTimelock is Script {
    function run() external {
        uint256 minDelay = vm.envOr("MIN_DELAY", uint256(2 days));
        address admin = vm.envOr("TIMELOCK_ADMIN", msg.sender);

        address proposer = vm.envOr("TIMELOCK_PROPOSER", admin);
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;

        // Open executor (address(0)) lets anyone execute a queued op once the delay elapses,
        // which is the common pattern; restrict via TIMELOCK_EXECUTOR for a closed set.
        address[] memory executors = new address[](1);
        executors[0] = vm.envOr("TIMELOCK_EXECUTOR", address(0));

        vm.startBroadcast();
        TimelockController timelock = new TimelockController(minDelay, proposers, executors, admin);
        vm.stopBroadcast();

        console2.log("TimelockController", address(timelock));
        console2.log("  minDelay (s)", minDelay);
        console2.log("  proposer", proposer);
    }
}
