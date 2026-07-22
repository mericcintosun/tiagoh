// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title TransferOwnership
/// @notice Hands ownership of every Ownable2Step tiagoh contract to `GOVERNANCE` (a Safe
///         multisig or the TimelockController from DeployTimelock.s.sol). Because the contracts
///         use Ownable2Step, this only INITIATES the transfer — governance must then call
///         `acceptOwnership()` on each contract to complete it, so a mistyped address can never
///         brick ownership.
///
/// @dev    Set the contract addresses via env (see .env.example); a zero address is skipped.
///         GOVERNANCE is required.
contract TransferOwnership is Script {
    function run() external {
        address gov = vm.envAddress("GOVERNANCE");
        require(gov != address(0), "GOVERNANCE unset");

        address[9] memory targets = [
            vm.envOr("RECEIPT_REGISTRY_ADDRESS", address(0)),
            vm.envOr("REVENUE_SPLIT_ADDRESS", address(0)),
            vm.envOr("CASCADE_CONTROLLER_ADDRESS", address(0)),
            vm.envOr("QUALITY_BOND_ADDRESS", address(0)),
            vm.envOr("ESCROW_VAULT_ADDRESS", address(0)),
            vm.envOr("DISPUTE_ARBITER_ADDRESS", address(0)),
            vm.envOr("REPUTATION_SCORER_ADDRESS", address(0)),
            vm.envOr("TOOL_AUCTION_ADDRESS", address(0)),
            vm.envOr("AGENT_REGISTRY_ADDRESS", address(0))
        ];

        vm.startBroadcast();
        for (uint256 i; i < targets.length; i++) {
            if (targets[i] == address(0)) continue;
            Ownable2Step(targets[i]).transferOwnership(gov);
            console2.log("transferOwnership -> governance:", targets[i]);
        }
        vm.stopBroadcast();

        console2.log("Pending. Governance must call acceptOwnership() on each contract.");
    }
}
