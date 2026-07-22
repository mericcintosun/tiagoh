// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SessionKeyDelegator} from "../src/SessionKeyDelegator.sol";
import {BitVM2Arbiter} from "../src/BitVM2Arbiter.sol";
import {ERC8004ReputationRegistry} from "../src/ERC8004ReputationRegistry.sol";
import {FeedbackAllowlist} from "../src/FeedbackAllowlist.sol";

/// @notice Deploys and live-exercises the three trust-layer additions on GOAT:
///         the ERC-4337 session-key enforcer, the BitVM2 optimistic arbiter, and an ERC-8004
///         reputation registry.
/// @dev    Mainnet-hardened arbiter: proposals require a configured verifier and (when
///         `proposalBond` > 0) an ERC-20 stake, and the challenge window has a 1-hour hard
///         minimum, so this script only deploys + wires + opens a dispute. `propose`/`rule`
///         are follow-up txs once the verifier is set and the window has passed.
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
        del.grant(sk, 1000, 0); // 1000-unit cap, no expiry → epoch 1
        // Spend authorizations are EIP-712 typed digests (chainId + contract + epoch bound).
        (,,,, uint256 epoch) = del.sessions(deployer, sk);
        bytes32 digest = del.spendHash(deployer, 400, 0, epoch);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(skPk, digest);
        require(del.spend(deployer, 400, 0, epoch, abi.encodePacked(r, s, v)) == sk, "sk mismatch");
        require(del.remaining(deployer, sk) == 600, "remaining mismatch");
        return address(del);
    }

    /// BitVM2 optimistic arbiter: deploy with a proposer-stake token, wire recourse to the
    /// live bond + escrow, and open a dispute (buyer = deployer). Proposing requires a
    /// verifier to be set (`setVerifier`) in a follow-up tx.
    function _arbiter(address deployer) internal returns (address) {
        address qualityBond = vm.envOr("QUALITY_BOND_ADDRESS", address(0xCed393a33e999C14a2E343DAA36fbEb84ce1A4E0));
        address escrowVault = vm.envOr("ESCROW_VAULT_ADDRESS", address(0x283c174Abf7F868Cda7B038C4a45CbCa45Aa45A7));
        address toolSubject = vm.envOr("REVENUE_SPLIT_ADDRESS", address(0x9A846F7bEAF29622579EF71D095Ae96c7345cd23));
        address stakeToken = vm.envOr("TIAGOH_PAYMENT_TOKEN", address(0x4ca4eDFf504Bb87D95a4DEAB67507bb1201De948));
        uint256 proposalBond = vm.envOr("PROPOSAL_BOND", uint256(10e6)); // 10 units of a 6-decimal token

        BitVM2Arbiter arb = new BitVM2Arbiter(deployer, stakeToken, proposalBond);
        arb.setRecourseTargets(qualityBond, escrowVault);
        uint256 disputeId =
            arb.openDispute(keccak256("tiagoh:receipt:onchain"), deployer, toolSubject, keccak256("tool:demo"), 0, 0);
        disputeId; // propose/challenge/rule exercised in follow-up txs once a verifier is set
        return address(arb);
    }

    /// ERC-8004 reputation registry: deploy Sybil-gated (allowlist authorizer), register an
    /// agent, and write real feedback from an authorized writer (the deployer/gateway).
    function _reputation(address deployer) internal returns (address) {
        address toolSubject = vm.envOr("REVENUE_SPLIT_ADDRESS", address(0x9A846F7bEAF29622579EF71D095Ae96c7345cd23));
        FeedbackAllowlist allow = new FeedbackAllowlist(deployer);
        allow.setWriter(deployer, true); // the gateway is the authorized reporter
        ERC8004ReputationRegistry rep = new ERC8004ReputationRegistry(address(allow));
        uint256 agentId = rep.registerAgent(toolSubject);
        rep.giveFeedback(
            agentId, int128(100), 0, "tiagoh", "success", "https://tiagoh.vercel.app/api/mcp", "receipt:onchain", keccak256("tiagoh:receipt:onchain")
        );
        return address(rep);
    }
}
