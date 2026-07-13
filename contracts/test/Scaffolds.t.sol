// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SessionKeyDelegator} from "../src/SessionKeyDelegator.sol";
import {BitVM2Arbiter} from "../src/BitVM2Arbiter.sol";

contract SessionKeyDelegatorTest is Test {
    SessionKeyDelegator del;
    uint256 constant SK_PK = 0xA11CE;
    address sk;
    address parent = address(0xBEEF);

    function setUp() public {
        del = new SessionKeyDelegator();
        sk = vm.addr(SK_PK);
        vm.prank(parent);
        del.grant(sk, 1000, 0);
    }

    function _sig(uint256 amount, uint256 nonce) internal view returns (bytes memory) {
        bytes32 eth = MessageHashUtils.toEthSignedMessageHash(del.spendHash(parent, amount, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SK_PK, eth);
        return abi.encodePacked(r, s, v);
    }

    function test_spend_withinCap_recoversSessionKey() public {
        address recovered = del.spend(parent, 400, 0, _sig(400, 0));
        assertEq(recovered, sk);
        assertEq(del.remaining(parent, sk), 600);
    }

    function test_spend_overCap_reverts() public {
        del.spend(parent, 400, 0, _sig(400, 0));
        bytes memory sig = _sig(700, 1); // compute before expectRevert (spendHash is an external call)
        vm.expectRevert(abi.encodeWithSelector(SessionKeyDelegator.CapExceeded.selector, 600, 700));
        del.spend(parent, 700, 1, sig);
    }

    function test_spend_badNonce_reverts() public {
        bytes memory sig = _sig(100, 5);
        vm.expectRevert(SessionKeyDelegator.BadNonce.selector);
        del.spend(parent, 100, 5, sig);
    }

    function test_revoke_blocksSpend() public {
        vm.prank(parent);
        del.revoke(sk);
        bytes memory sig = _sig(100, 0);
        vm.expectRevert(SessionKeyDelegator.NotActive.selector);
        del.spend(parent, 100, 0, sig);
    }
}

contract MockVerifier {
    bool public fraud;

    function setFraud(bool f) external {
        fraud = f;
    }

    function verifyChallenge(bytes32, bytes calldata) external view returns (bool) {
        return fraud;
    }
}

contract MockBond {
    uint256 public slashed;
    address public to;

    function slash(bytes32, uint256 amount, address to_) external {
        slashed = amount;
        to = to_;
    }
}

contract MockEscrow {
    uint256 public refunded;

    function refund(uint256 escrowId) external {
        refunded = escrowId;
    }
}

contract BitVM2ArbiterTest is Test {
    BitVM2Arbiter arb;
    MockBond bond;
    MockEscrow escrow;
    MockVerifier verifier;
    address buyer = address(0xB1);
    address seller = address(0x5E);
    bytes32 toolId = keccak256("tool");
    bytes32 subject = keccak256("receipt");

    function setUp() public {
        arb = new BitVM2Arbiter(address(this));
        bond = new MockBond();
        escrow = new MockEscrow();
        verifier = new MockVerifier();
        arb.setRecourseTargets(address(bond), address(escrow));
        arb.setVerifier(address(verifier));
    }

    function _open() internal returns (uint256 id) {
        id = arb.openDispute(subject, buyer, seller, toolId, 7, 300);
    }

    function test_optimistic_ruleForBuyer_afterWindow_refundsAndSlashes() public {
        uint256 id = _open();
        arb.propose(id, true);
        // cannot rule before the window
        vm.expectRevert(BitVM2Arbiter.WindowNotElapsed.selector);
        arb.rule(id, true);
        vm.warp(block.timestamp + 2 hours);
        arb.rule(id, true);
        assertEq(escrow.refunded(), 7);
        assertEq(bond.slashed(), 300);
        assertEq(bond.to(), buyer);
    }

    function test_challenge_provenFraud_flipsRuling() public {
        uint256 id = _open();
        arb.propose(id, true); // proposed for buyer
        verifier.setFraud(true); // the challenge proves the proposal was fraudulent
        arb.challenge(id, hex"01");
        // ruling flipped to seller → no refund/slash
        assertEq(escrow.refunded(), 0);
        assertEq(bond.slashed(), 0);
    }

    function test_challenge_noFraud_keepsRuling() public {
        uint256 id = _open();
        arb.propose(id, true);
        verifier.setFraud(false);
        arb.challenge(id, hex"01");
        assertEq(escrow.refunded(), 7);
        assertEq(bond.slashed(), 300);
    }
}
