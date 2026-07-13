// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SessionKeyDelegator} from "../src/SessionKeyDelegator.sol";
import {BitVM2Arbiter} from "../src/BitVM2Arbiter.sol";
import {ERC8004ReputationRegistry} from "../src/ERC8004ReputationRegistry.sol";

/// @notice Deploys and live-exercises the three trust-layer additions on GOAT Testnet3:
///         the ERC-4337 session-key enforcer, the BitVM2 optimistic arbiter, and an ERC-8004
///         reputation registry. rule() on the arbiter is finalized in a follow-up cast call once
///         block time passes the (zeroed) challenge window.
contract DeployScaffolds is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);
        address del = _sessionKey(deployer, pk);
        address arb = _arbiter(deployer);
        address rep = _reputation(deployer);
        vm.stopBroadcast();

        console2.log("SessionKeyDelegator", del);
        console2.log("BitVM2Arbiter", arb);
        console2.log("ERC8004ReputationRegistry", rep);
    }

    /// ERC-4337 session-key enforcer: deploy, grant a capped key, spend within cap.
    function _sessionKey(address deployer, uint256 pk) internal returns (address) {
        pk; // deployer is the parent granter
        SessionKeyDelegator del = new SessionKeyDelegator();
        uint256 skPk = 0xA11CE;
        address sk = vm.addr(skPk);
        del.grant(sk, 1000, 0); // 1000-unit cap, no expiry
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(del.spendHash(deployer, 400, 0));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(skPk, h);
        require(del.spend(deployer, 400, 0, abi.encodePacked(r, s, v)) == sk, "sk mismatch");
        require(del.remaining(deployer, sk) == 600, "remaining mismatch");
        return address(del);
    }

    /// BitVM2 optimistic arbiter: deploy, wire recourse to the live bond + escrow, open + propose.
    function _arbiter(address deployer) internal returns (address) {
        address qualityBond = vm.envOr("QUALITY_BOND_ADDRESS", address(0xCed393a33e999C14a2E343DAA36fbEb84ce1A4E0));
        address escrowVault = vm.envOr("ESCROW_VAULT_ADDRESS", address(0x283c174Abf7F868Cda7B038C4a45CbCa45Aa45A7));
        address toolSubject = vm.envOr("REVENUE_SPLIT_ADDRESS", address(0x9A846F7bEAF29622579EF71D095Ae96c7345cd23));
        BitVM2Arbiter arb = new BitVM2Arbiter(deployer);
        arb.setRecourseTargets(qualityBond, escrowVault);
        arb.setChallengeWindow(0); // finalize path exercised via a follow-up rule() tx
        uint256 disputeId =
            arb.openDispute(keccak256("tiagoh:receipt:onchain"), deployer, toolSubject, keccak256("tool:demo"), 0, 0);
        arb.propose(disputeId, true);
        return address(arb);
    }

    /// ERC-8004 reputation registry: deploy, register an agent, write real feedback.
    function _reputation(address deployer) internal returns (address) {
        deployer;
        address toolSubject = vm.envOr("REVENUE_SPLIT_ADDRESS", address(0x9A846F7bEAF29622579EF71D095Ae96c7345cd23));
        ERC8004ReputationRegistry rep = new ERC8004ReputationRegistry();
        uint256 agentId = rep.registerAgent(toolSubject);
        rep.giveFeedback(
            agentId, int128(100), 0, "tiagoh", "success", "https://tiagoh.vercel.app/api/mcp", "receipt:onchain", keccak256("tiagoh:receipt:onchain")
        );
        return address(rep);
    }
}
