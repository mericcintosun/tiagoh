// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {DemoToken} from "../src/DemoToken.sol";
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
import {FeedbackAllowlist} from "../src/FeedbackAllowlist.sol";
import {ERC8004ReputationRegistry} from "../src/ERC8004ReputationRegistry.sol";
import {BitVM2Arbiter} from "../src/BitVM2Arbiter.sol";

/// @title DeployMainnet
/// @notice One-shot GOAT MAINNET launch: a demo payment token + the full tiagoh suite, wired,
///         guarded-launch capped, and proven live with a genesis receipt anchored on-chain.
///         BitVM2Arbiter is deployed but deliberately NOT authorized on bond/escrow (no real
///         verifier yet — see docs/SECURITY.md); the permissioned DisputeArbiter is authorized.
contract DeployMainnet is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 maxEscrow = vm.envOr("MAX_ESCROW", uint256(50e6)); // $50 guarded cap
        uint256 maxBudget = vm.envOr("MAX_BUDGET", uint256(100e6)); // $100 guarded cap
        uint256 channelCap = vm.envOr("CHANNEL_DEPOSIT_CAP", uint256(100e6));
        uint256 proposalBond = vm.envOr("PROPOSAL_BOND", uint256(10e6));

        vm.startBroadcast(pk);

        // 1. Demo payment token (clearly labeled test token) + a demo balance.
        DemoToken token = new DemoToken(deployer);
        token.mint(deployer, 1_000_000e6);

        // 2. Core suite.
        ReceiptRegistry receipts = new ReceiptRegistry(deployer);
        RevenueSplit split = _revenueSplit(address(token), deployer);
        CascadeController cascade = new CascadeController(deployer);
        PaymentChannel channel = new PaymentChannel(channelCap);
        QualityBond bond = new QualityBond(address(token), deployer);
        EscrowVault escrow = new EscrowVault(deployer);
        DisputeArbiter arbiter = new DisputeArbiter(deployer);
        ReputationScorer scorer = new ReputationScorer(address(0), deployer);
        ToolAuction auction = new ToolAuction(deployer);
        AgentRegistry agents = new AgentRegistry(address(0), deployer);

        // 3. Trust-layer additions.
        SessionKeyDelegator session = new SessionKeyDelegator();
        FeedbackAllowlist allow = new FeedbackAllowlist(deployer);
        allow.setWriter(deployer, true);
        ERC8004ReputationRegistry rep = new ERC8004ReputationRegistry(address(allow));
        BitVM2Arbiter bitvm = new BitVM2Arbiter(deployer, address(token), proposalBond);

        // 4. Wiring (permissioned arbiter authorized; BitVM2 intentionally NOT authorized yet).
        receipts.setRecorder(deployer, true);
        escrow.setArbiter(address(arbiter), true);
        bond.setArbiter(address(arbiter), true);
        arbiter.setRecourseTargets(address(bond), address(escrow));
        scorer.setReporter(deployer, true);

        // 5. Guarded-launch caps.
        escrow.setMaxEscrow(maxEscrow);
        cascade.setMaxBudget(maxBudget);

        // 6. Proof of life: anchor a genesis receipt + register an ERC-8004 agent + feedback.
        receipts.recordReceipt(
            keccak256("tiagoh:mainnet:genesis"), bytes32(0), deployer, deployer, address(token), 100, keccak256("get_goat_market_data")
        );
        uint256 agentId = rep.registerAgent(address(split));
        rep.giveFeedback(
            agentId, int128(100), 0, "tiagoh", "success", "https://tiagoh.vercel.app/api/mcp", "receipt:mainnet:genesis", keccak256("tiagoh:mainnet:genesis")
        );

        vm.stopBroadcast();

        console2.log("=== tiagoh GOAT MAINNET ===");
        console2.log("DemoToken                 ", address(token));
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
        console2.log("FeedbackAllowlist         ", address(allow));
        console2.log("ERC8004ReputationRegistry ", address(rep));
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
