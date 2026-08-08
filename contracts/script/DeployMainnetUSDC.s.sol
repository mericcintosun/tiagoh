// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

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
import {SessionKeyDelegator} from "../src/SessionKeyDelegator.sol";
import {BitVM2Arbiter} from "../src/BitVM2Arbiter.sol";

/// @title DeployMainnetUSDC
/// @notice GOAT mainnet redeploy of the tiagoh suite bound to a REAL bridged stablecoin
///         (USDC.e `0x3022b87a…`) instead of the launch DemoToken. Differences from
///         DeployMainnet.s.sol:
///           - no token is deployed or minted; PAYMENT_TOKEN is read from env
///           - the private ERC8004ReputationRegistry fork + FeedbackAllowlist are gone —
///             reputation now writes to the CANONICAL registries at 0x8004… (same ABI)
///           - genesis receipt records the real token address
///         Guarded-launch caps and griefing controls carry over unchanged.
contract DeployMainnetUSDC is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address token = vm.envAddress("PAYMENT_TOKEN"); // USDC.e on GOAT mainnet
        require(token.code.length > 0, "PAYMENT_TOKEN has no code");

        uint256 maxEscrow = vm.envOr("MAX_ESCROW", uint256(50e6)); // $50 guarded cap
        uint256 maxBudget = vm.envOr("MAX_BUDGET", uint256(100e6)); // $100 guarded cap
        uint256 channelCap = vm.envOr("CHANNEL_DEPOSIT_CAP", uint256(100e6));
        uint256 proposalBond = vm.envOr("PROPOSAL_BOND", uint256(10e6));
        uint256 disputeStake = vm.envOr("DISPUTE_STAKE", uint256(1e6)); // $1 to open a dispute
        uint256 bidBond = vm.envOr("BID_BOND", uint256(1e6)); // $1 to bid in an auction

        vm.startBroadcast(pk);

        // 1. Core suite, bound to the real stablecoin.
        ReceiptRegistry receipts = new ReceiptRegistry(deployer);
        RevenueSplit split = _revenueSplit(token, deployer);
        CascadeController cascade = new CascadeController(deployer);
        PaymentChannel channel = new PaymentChannel(channelCap);
        QualityBond bond = new QualityBond(token, deployer);
        EscrowVault escrow = new EscrowVault(deployer);
        DisputeArbiter arbiter = new DisputeArbiter(deployer, token);
        ReputationScorer scorer = new ReputationScorer(address(0), deployer);
        ToolAuction auction = new ToolAuction(deployer, token);
        AgentRegistry agents = new AgentRegistry(address(0), deployer);
        SessionKeyDelegator session = new SessionKeyDelegator();
        BitVM2Arbiter bitvm = new BitVM2Arbiter(deployer, token, proposalBond);

        // 2. Wiring — same role model as the launch deploy: the permissioned DisputeArbiter
        //    is authorized, BitVM2Arbiter is wired read-only and NOT authorized on value.
        receipts.setRecorder(deployer, true);
        escrow.setArbiter(address(arbiter), true);
        bond.setArbiter(address(arbiter), true);
        arbiter.setRecourseTargets(address(bond), address(escrow), address(receipts));
        arbiter.setJuror(deployer, true);
        scorer.setReporter(deployer, true);
        scorer.setQualityBond(address(bond));
        bitvm.setRecourseTargets(address(bond), address(escrow), address(receipts));

        // 3. Guarded-launch caps + griefing controls.
        escrow.setMaxEscrow(maxEscrow);
        cascade.setMaxBudget(maxBudget);
        arbiter.setDisputeStake(disputeStake);
        auction.setBidBond(bidBond);
        auction.setReputationScorer(address(scorer));

        // 4. Proof of life: a genesis receipt that names the REAL token.
        receipts.recordReceipt(
            keccak256("tiagoh:mainnet:usdc:genesis"),
            bytes32(0),
            deployer,
            deployer,
            token,
            0,
            keccak256("genesis")
        );

        vm.stopBroadcast();

        console2.log("=== tiagoh GOAT MAINNET (USDC.e) ===");
        console2.log("PaymentToken (USDC.e)     ", token);
        console2.log("ReceiptRegistry           ", address(receipts));
        console2.log("RevenueSplit              ", address(split));
        console2.log("CascadeController         ", address(cascade));
        console2.log("PaymentChannel            ", address(channel));
        console2.log("QualityBond               ", address(bond));
        console2.log("EscrowVault               ", address(escrow));
        console2.log("DisputeArbiter            ", address(arbiter));
        console2.log("ReputationScorer          ", address(scorer));
        console2.log("ToolAuction               ", address(auction));
        console2.log("AgentRegistry             ", address(agents));
        console2.log("SessionKeyDelegator       ", address(session));
        console2.log("BitVM2Arbiter             ", address(bitvm));
        console2.log("receipts.count            ", receipts.count());
    }

    function _revenueSplit(address token, address owner) internal returns (RevenueSplit) {
        address[] memory payees = new address[](1);
        payees[0] = owner;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 1;
        return new RevenueSplit(token, payees, shares, owner);
    }
}
