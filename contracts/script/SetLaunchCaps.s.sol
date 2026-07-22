// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {CascadeController} from "../src/CascadeController.sol";

/// @title SetLaunchCaps
/// @notice Guarded-launch control: caps the value at risk per escrow / per cascade so a
///         pre-audit mainnet bounds losses to a small amount even if a bug slips through.
///         Raise the caps (or set them to 0 = unlimited) as confidence and audit coverage grow.
///         The PaymentChannel cap is immutable and set at deploy (CHANNEL_DEPOSIT_CAP).
///
/// @dev    Env:
///           ESCROW_VAULT_ADDRESS, CASCADE_CONTROLLER_ADDRESS
///           MAX_ESCROW   (default 50e6  = $50 of a 6-decimal token)
///           MAX_BUDGET   (default 100e6 = $100)
contract SetLaunchCaps is Script {
    function run() external {
        uint256 maxEscrow = vm.envOr("MAX_ESCROW", uint256(50e6));
        uint256 maxBudget = vm.envOr("MAX_BUDGET", uint256(100e6));

        vm.startBroadcast();
        address ev = vm.envOr("ESCROW_VAULT_ADDRESS", address(0));
        if (ev != address(0)) {
            EscrowVault(ev).setMaxEscrow(maxEscrow);
            console2.log("EscrowVault.maxEscrow", maxEscrow);
        }
        address cc = vm.envOr("CASCADE_CONTROLLER_ADDRESS", address(0));
        if (cc != address(0)) {
            CascadeController(cc).setMaxBudget(maxBudget);
            console2.log("CascadeController.maxBudget", maxBudget);
        }
        vm.stopBroadcast();
    }
}
