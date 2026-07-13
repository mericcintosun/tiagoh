// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

contract ReceiptRegistryTest is Test {
    ReceiptRegistry internal registry;

    address internal owner = address(0xA0);
    address internal recorder = address(0xB0);
    address internal payer = address(0xC0);
    address internal payee = address(0xD0);
    address internal token = address(0xE0);

    function setUp() public {
        registry = new ReceiptRegistry(owner);
        vm.prank(owner);
        registry.setRecorder(recorder, true);
    }

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
}
