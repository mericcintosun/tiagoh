// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {X402Settler} from "../src/X402Settler.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

/// @title DeployX402Settler
/// @notice Deploys the atomic x402 settler against an existing ReceiptRegistry and payment token,
///         then grants it the two things it needs to work: the recorder role (for `settleBare`,
///         the path standard x402 clients take) and a gateway operator.
///
/// @dev    The fee starts at **zero**. Turning it on is a separate, deliberate transaction
///         (`setFeeBps`), so deploying this contract changes nothing economically until someone
///         decides it should.
///
///         `MAX_SETTLEMENT` is the guarded-launch cap, consistent with `EscrowVault.maxEscrow`
///         and `CascadeController.maxBudget` (SECURITY.md §4c). The suite is not independently
///         audited, so the ceiling on a single settlement is the ceiling on a single loss.
///
/// Usage:
///   PRIVATE_KEY=0x… PAYMENT_TOKEN=0x3022b87a… RECEIPT_REGISTRY=0xa5bEfC1b… \
///   GATEWAY_OPERATOR=0x… forge script script/DeployX402Settler.s.sol \
///     --rpc-url https://rpc.goat.network --broadcast
contract DeployX402Settler is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address token = vm.envAddress("PAYMENT_TOKEN");
        address registryAddr = vm.envAddress("RECEIPT_REGISTRY");
        address treasury = vm.envOr("TIAGOH_TREASURY", deployer);
        address operator = vm.envOr("GATEWAY_OPERATOR", deployer);
        uint256 maxSettlement = vm.envOr("MAX_SETTLEMENT", uint256(5e6)); // $5 guarded cap
        uint256 feeBps = vm.envOr("TIAGOH_FEE_BPS", uint256(0)); // off by default

        require(token.code.length > 0, "PAYMENT_TOKEN has no code");
        require(registryAddr.code.length > 0, "RECEIPT_REGISTRY has no code");

        ReceiptRegistry registry = ReceiptRegistry(registryAddr);
        require(registry.owner() == deployer, "deployer does not own the registry; cannot grant recorder");

        vm.startBroadcast(pk);

        X402Settler settler = new X402Settler(token, registryAddr, treasury, deployer);

        // `settleBare` writes a RECORDER-level receipt for x402 clients that produce no tiagoh
        // receipt signatures. Unlike a gateway's unilateral telemetry, a settler-written receipt
        // is emitted in the same transaction as a real token transfer, so it cannot describe a
        // payment that did not happen.
        registry.setRecorder(address(settler), true);

        // Only allowlisted gateways may call `settleBare`: without receipt signatures nothing
        // binds `payee`, so a permissionless version would let a mempool watcher re-point a
        // pending authorization at themselves.
        settler.setOperator(operator, true);
        settler.setMaxSettlement(maxSettlement);
        if (feeBps > 0) settler.setFeeBps(feeBps);

        vm.stopBroadcast();

        console2.log("X402Settler      ", address(settler));
        console2.log("  token          ", token);
        console2.log("  registry       ", registryAddr);
        console2.log("  treasury       ", treasury);
        console2.log("  operator       ", operator);
        console2.log("  feeBps         ", settler.feeBps());
        console2.log("  maxSettlement  ", maxSettlement);
        console2.log("  isRecorder     ", registry.isRecorder(address(settler)));
    }
}
