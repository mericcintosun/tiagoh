// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";
import {RevenueSplit} from "../src/RevenueSplit.sol";
import {CascadeController} from "../src/CascadeController.sol";
import {PaymentChannel} from "../src/PaymentChannel.sol";
import {QualityBond} from "../src/QualityBond.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {DisputeArbiter} from "../src/DisputeArbiter.sol";
import {ReputationScorer} from "../src/ReputationScorer.sol";
import {ToolAuction} from "../src/ToolAuction.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

/// @title Deploy
/// @notice Deploys the full tiagoh contract suite for GOAT testnet and logs addresses.
///         Configure via env:
///           - OWNER                (defaults to the tx sender)
///           - PAYMENT_TOKEN        (ERC-3009 stablecoin settled by the GOAT facilitator)
///           - ERC8004_REPUTATION   (canonical ERC-8004 Reputation Registry on GOAT)
///           - ERC8004_IDENTITY     (canonical ERC-8004 Identity Registry on GOAT)
///
///         Run without broadcasting:  forge script script/Deploy.s.sol
///         With broadcast:            bash deploy.sh   (recommended — sets GOAT's min gas tip)
///
///         NOTE: GOAT Testnet3 requires maxPriorityFeePerGas >= 130000 wei; a bare
///         `--broadcast` underprices it ("gas price below minimum"). Use deploy.sh
///         (or pass --priority-gas-price 200000 --with-gas-price 1000000).
contract Deploy is Script {
    function run() external {
        address owner = vm.envOr("OWNER", msg.sender);
        address paymentToken =
            vm.envOr("PAYMENT_TOKEN", address(0x1111111111111111111111111111111111111111));
        address erc8004Reputation = vm.envOr("ERC8004_REPUTATION", address(0x8004));
        address erc8004Identity = vm.envOr("ERC8004_IDENTITY", address(0x8004));

        vm.startBroadcast();
        _deployAll(owner, paymentToken, erc8004Reputation, erc8004Identity);
        vm.stopBroadcast();
    }

    /// @dev Deployments are inlined into the log calls so no long-lived locals accumulate.
    function _deployAll(address owner, address paymentToken, address rep, address ident)
        internal
    {
        console2.log("tiagoh contracts deployed:");
        console2.log("  ReceiptRegistry    ", address(new ReceiptRegistry(owner)));
        console2.log("  RevenueSplit       ", address(_deployRevenueSplit(paymentToken, owner)));
        console2.log("  CascadeController  ", address(new CascadeController(owner)));
        console2.log("  PaymentChannel     ", address(new PaymentChannel()));
        console2.log("  QualityBond        ", address(new QualityBond(paymentToken, owner)));
        console2.log("  EscrowVault        ", address(new EscrowVault(owner)));
        console2.log("  DisputeArbiter     ", address(new DisputeArbiter(owner)));
        console2.log("  ReputationScorer   ", address(new ReputationScorer(rep, owner)));
        console2.log("  ToolAuction        ", address(new ToolAuction(owner)));
        console2.log("  AgentRegistry      ", address(new AgentRegistry(ident, owner)));
    }

    /// @dev Default splitter: 100% to the owner; adjust payees/shares per deployment.
    function _deployRevenueSplit(address paymentToken, address owner)
        internal
        returns (RevenueSplit)
    {
        address[] memory payees = new address[](1);
        payees[0] = owner;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1;
        return new RevenueSplit(paymentToken, payees, shares, owner);
    }
}
