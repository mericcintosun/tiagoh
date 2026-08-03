// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";
import {MockERC1271Signer} from "./mocks/MockERC1271Signer.sol";

contract ReceiptRegistryTest is Test {
    ReceiptRegistry internal registry;

    address internal owner = address(0xA0);
    address internal recorder = address(0xB0);
    address internal token = address(0xE0);

    uint256 internal payerPk = 0xA11CE;
    uint256 internal payeePk = 0xB0B;
    address internal payer;
    address internal payee;

    function setUp() public {
        payer = vm.addr(payerPk);
        payee = vm.addr(payeePk);
        registry = new ReceiptRegistry(owner);
        vm.prank(owner);
        registry.setRecorder(recorder, true);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _input(bytes32 receiptId, bytes32 parentId, uint256 amount)
        internal
        view
        returns (ReceiptRegistry.ReceiptInput memory)
    {
        return ReceiptRegistry.ReceiptInput({
            receiptId: receiptId,
            parentId: parentId,
            payer: payer,
            payee: payee,
            token: token,
            amount: amount,
            toolId: keccak256("tool")
        });
    }

    function _sign(uint256 pk, ReceiptRegistry.ReceiptInput memory r)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, registry.receiptHash(r));
        return abi.encodePacked(rr, s, v);
    }

    // ── recorder path (telemetry) ────────────────────────────────────────────

    function test_recordReceipt_updatesAggregates() public {
        bytes32 root = keccak256("root");
        bytes32 child = keccak256("child");

        vm.startPrank(recorder);
        registry.recordReceipt(root, bytes32(0), payer, payee, token, 100, keccak256("toolA"));
        registry.recordReceipt(child, root, payer, payee, token, 40, keccak256("toolB"));
        vm.stopPrank();

        assertEq(registry.count(), 2, "count");
        assertEq(registry.totalVolume(), 140, "volume");
        assertEq(registry.childCount(root), 1, "child link");
        assertTrue(registry.exists(root));
        assertTrue(registry.exists(child));
    }

    function test_recordReceipt_dedupes() public {
        bytes32 id = keccak256("dup");
        vm.startPrank(recorder);
        registry.recordReceipt(id, bytes32(0), payer, payee, token, 10, keccak256("t"));
        vm.expectRevert(abi.encodeWithSelector(ReceiptRegistry.DuplicateReceipt.selector, id));
        registry.recordReceipt(id, bytes32(0), payer, payee, token, 10, keccak256("t"));
        vm.stopPrank();
    }

    function test_recordReceipt_onlyRecorder() public {
        vm.expectRevert(ReceiptRegistry.NotRecorder.selector);
        registry.recordReceipt(keccak256("x"), bytes32(0), payer, payee, token, 1, bytes32(0));
    }

    /// @dev Least privilege: the owner key must not be able to mint receipts, because receipts
    ///      feed reputation. The owner may only (re)assign recorders.
    function test_recordReceipt_ownerIsNotImplicitlyRecorder() public {
        vm.prank(owner);
        vm.expectRevert(ReceiptRegistry.NotRecorder.selector);
        registry.recordReceipt(keccak256("x"), bytes32(0), payer, payee, token, 1, bytes32(0));
    }

    /// @dev A recorder-written receipt is telemetry, never evidence.
    function test_recordedReceipt_isNotCosigned() public {
        bytes32 id = keccak256("telemetry");
        vm.prank(recorder);
        registry.recordReceipt(id, bytes32(0), payer, payee, token, 10, keccak256("t"));

        assertTrue(registry.exists(id), "exists");
        assertFalse(registry.isCosigned(id), "must not count as evidence");
        assertEq(registry.cosignedCount(), 0, "cosigned tally");

        (,,,,, bool cosigned) = registry.receiptEvidence(id);
        assertFalse(cosigned, "evidence flag");
    }

    // ── co-signed path (evidence) ────────────────────────────────────────────

    function test_anchorReceipt_permissionlessWithBothSignatures() public {
        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("cosigned"), bytes32(0), 250);
        bytes memory payerSig = _sign(payerPk, r);
        bytes memory payeeSig = _sign(payeePk, r);

        // Submitted by an unrelated relayer: validity comes from the signatures, not the sender.
        vm.prank(address(0xBEEF));
        registry.anchorReceipt(r, payerSig, payeeSig);

        assertTrue(registry.isCosigned(r.receiptId), "cosigned");
        assertEq(registry.cosignedCount(), 1, "cosigned tally");
        assertEq(registry.count(), 1, "count");
        assertEq(registry.totalVolume(), 250, "volume");

        (
            address gotPayer,
            address gotPayee,
            uint256 amount,
            bytes32 toolId,
            uint64 ts,
            bool cosigned
        ) = registry.receiptEvidence(r.receiptId);
        assertEq(gotPayer, payer, "payer");
        assertEq(gotPayee, payee, "payee");
        assertEq(amount, 250, "amount");
        assertEq(toolId, keccak256("tool"), "toolId");
        assertEq(ts, uint64(block.timestamp), "timestamp");
        assertTrue(cosigned, "evidence flag");
    }

    function test_anchorReceipt_rejectsForgedPayerSignature() public {
        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("forged-payer"), bytes32(0), 10);
        // The seller signs both halves — exactly the unilateral forgery co-signing must stop.
        bytes memory payeeSig = _sign(payeePk, r);

        vm.expectRevert(ReceiptRegistry.BadPayerSignature.selector);
        registry.anchorReceipt(r, payeeSig, payeeSig);
    }

    function test_anchorReceipt_rejectsForgedPayeeSignature() public {
        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("forged-payee"), bytes32(0), 10);
        bytes memory payerSig = _sign(payerPk, r);

        vm.expectRevert(ReceiptRegistry.BadPayeeSignature.selector);
        registry.anchorReceipt(r, payerSig, payerSig);
    }

    /// @dev A signature is bound to the exact tuple: tampering with the amount after signing
    ///      invalidates both signatures.
    function test_anchorReceipt_rejectsTamperedAmount() public {
        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("tamper"), bytes32(0), 10);
        bytes memory payerSig = _sign(payerPk, r);
        bytes memory payeeSig = _sign(payeePk, r);

        r.amount = 10_000; // seller inflates the bill after the fact
        vm.expectRevert(ReceiptRegistry.BadPayerSignature.selector);
        registry.anchorReceipt(r, payerSig, payeeSig);
    }

    function test_anchorReceipt_dedupes() public {
        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("once"), bytes32(0), 10);
        bytes memory payerSig = _sign(payerPk, r);
        bytes memory payeeSig = _sign(payeePk, r);

        registry.anchorReceipt(r, payerSig, payeeSig);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiptRegistry.DuplicateReceipt.selector, r.receiptId)
        );
        registry.anchorReceipt(r, payerSig, payeeSig);
    }

    function test_anchorReceipt_linksCascadeParent() public {
        ReceiptRegistry.ReceiptInput memory root = _input(keccak256("p"), bytes32(0), 100);
        registry.anchorReceipt(root, _sign(payerPk, root), _sign(payeePk, root));

        ReceiptRegistry.ReceiptInput memory child = _input(keccak256("c"), root.receiptId, 40);
        registry.anchorReceipt(child, _sign(payerPk, child), _sign(payeePk, child));

        assertEq(registry.childCount(root.receiptId), 1, "fan-out");
    }

    function test_anchorReceipt_rejectsZeroParty() public {
        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("zero"), bytes32(0), 10);
        bytes memory payerSig = _sign(payerPk, r);
        bytes memory payeeSig = _sign(payeePk, r);
        r.payee = address(0);

        vm.expectRevert(ReceiptRegistry.ZeroParty.selector);
        registry.anchorReceipt(r, payerSig, payeeSig);
    }

    /// @dev ERC-1271: an ERC-4337 agent wallet must be able to be the payer.
    function test_anchorReceipt_acceptsErc1271SmartAccountPayer() public {
        MockERC1271Signer account = new MockERC1271Signer(vm.addr(payerPk));

        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("1271"), bytes32(0), 77);
        r.payer = address(account);

        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(payerPk, registry.receiptHash(r));
        bytes memory accountSig = abi.encodePacked(rr, s, v);

        registry.anchorReceipt(r, accountSig, _sign(payeePk, r));
        assertTrue(registry.isCosigned(r.receiptId), "1271 payer accepted");
    }

    /// @dev The EIP-712 domain binds chainId, so a receipt signed for one chain is dead on another.
    function test_anchorReceipt_signatureDoesNotReplayAcrossChains() public {
        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("chain"), bytes32(0), 10);
        bytes memory payerSig = _sign(payerPk, r);
        bytes memory payeeSig = _sign(payeePk, r);

        vm.chainId(block.chainid + 1);
        vm.expectRevert(ReceiptRegistry.BadPayerSignature.selector);
        registry.anchorReceipt(r, payerSig, payeeSig);
    }

    /// @dev Same tuple, different registry deployment: the domain separator differs, so a
    ///      signature harvested from one deployment cannot be anchored on another.
    function test_anchorReceipt_signatureDoesNotReplayAcrossDeployments() public {
        ReceiptRegistry.ReceiptInput memory r = _input(keccak256("deploy"), bytes32(0), 10);
        bytes memory payerSig = _sign(payerPk, r);
        bytes memory payeeSig = _sign(payeePk, r);

        ReceiptRegistry other = new ReceiptRegistry(owner);
        vm.expectRevert(ReceiptRegistry.BadPayerSignature.selector);
        other.anchorReceipt(r, payerSig, payeeSig);
    }
}
