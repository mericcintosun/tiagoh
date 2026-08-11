// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title TimelockAccept
/// @notice Completes the ownership handover started by `TransferOwnership.s.sol`.
///
/// @dev    The contracts are `Ownable2Step`, so a transfer is only *offered* until the new owner
///         calls `acceptOwnership()`. When the new owner is a timelock, it cannot simply call it:
///         every action has to be scheduled, wait out `minDelay`, and then be executed. So this
///         script runs in two modes.
///
///           MODE=schedule   queue `acceptOwnership()` on every configured contract
///           MODE=execute    run the queued batch once `minDelay` has elapsed
///
///         Between the two, nothing is at risk: the deployer is still the owner, because an
///         unaccepted transfer changes nothing. That is exactly why Ownable2Step is worth the
///         extra step — a mistyped governance address cannot strand a contract.
///
/// Usage:
///   MODE=schedule TIMELOCK=0x… PRIVATE_KEY=0x… forge script script/TimelockAccept.s.sol \
///     --rpc-url https://rpc.goat.network --broadcast --priority-gas-price 200000
///   …wait minDelay…
///   MODE=execute  TIMELOCK=0x… PRIVATE_KEY=0x… forge script script/TimelockAccept.s.sol \
///     --rpc-url https://rpc.goat.network --broadcast --priority-gas-price 200000
contract TimelockAccept is Script {
    /// @dev Fixed, so `schedule` and `execute` derive the same operation id. Changing it would
    ///      make an already-queued batch unexecutable.
    bytes32 constant SALT = keccak256("tiagoh:acceptOwnership:v1");

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK")));
        string memory mode = vm.envString("MODE");

        address[11] memory candidates = [
            vm.envOr("X402_SETTLER_ADDRESS", address(0)),
            vm.envOr("RECEIPT_REGISTRY_ADDRESS", address(0)),
            vm.envOr("REVENUE_SPLIT_ADDRESS", address(0)),
            vm.envOr("CASCADE_CONTROLLER_ADDRESS", address(0)),
            vm.envOr("QUALITY_BOND_ADDRESS", address(0)),
            vm.envOr("ESCROW_VAULT_ADDRESS", address(0)),
            vm.envOr("DISPUTE_ARBITER_ADDRESS", address(0)),
            vm.envOr("REPUTATION_SCORER_ADDRESS", address(0)),
            vm.envOr("TOOL_AUCTION_ADDRESS", address(0)),
            vm.envOr("AGENT_REGISTRY_ADDRESS", address(0)),
            vm.envOr("BITVM2_ARBITER_ADDRESS", address(0))
        ];

        uint256 n;
        for (uint256 i; i < candidates.length; i++) {
            if (candidates[i] != address(0)) n++;
        }
        require(n > 0, "no contract addresses configured");

        address[] memory targets = new address[](n);
        uint256[] memory values = new uint256[](n);
        bytes[] memory payloads = new bytes[](n);
        uint256 j;
        for (uint256 i; i < candidates.length; i++) {
            if (candidates[i] == address(0)) continue;
            targets[j] = candidates[i];
            values[j] = 0;
            payloads[j] = abi.encodeWithSignature("acceptOwnership()");
            j++;
        }

        bytes32 id = timelock.hashOperationBatch(targets, values, payloads, 0, SALT);
        console2.log("operation id:");
        console2.logBytes32(id);

        vm.startBroadcast(pk);
        if (keccak256(bytes(mode)) == keccak256("schedule")) {
            uint256 delay = timelock.getMinDelay();
            timelock.scheduleBatch(targets, values, payloads, 0, SALT, delay);
            console2.log("scheduled; executable after (s):", delay);
        } else if (keccak256(bytes(mode)) == keccak256("execute")) {
            require(timelock.isOperationReady(id), "not ready: minDelay has not elapsed");
            timelock.executeBatch(targets, values, payloads, 0, SALT);
            console2.log("executed: the timelock now owns", n, "contracts");
        } else {
            revert("MODE must be schedule or execute");
        }
        vm.stopBroadcast();
    }
}
