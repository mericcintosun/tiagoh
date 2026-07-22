// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IReceiptRegistry} from "./interfaces/IReceiptRegistry.sol";

/// @title ReceiptRegistry
/// @notice Anchors every settled x402 tool call on-chain with its cascade `parentId`,
///         so the full payment graph reconstructs from chain data alone (PRD §5.0 C5).
/// @dev    Recording is permissioned to gateway recorders. Receipts are immutable and
///         duplicate-protected by `receiptId`.
contract ReceiptRegistry is Ownable2Step, IReceiptRegistry {
    struct Receipt {
        bytes32 parentId;
        address payer;
        address payee;
        address token;
        uint256 amount;
        bytes32 toolId;
        uint64 timestamp;
        bool exists;
    }

    /// @dev receiptId => Receipt
    mapping(bytes32 => Receipt) private _receipts;
    /// @dev authorized gateway recorders
    mapping(address => bool) public isRecorder;
    /// @dev parentId => number of direct child receipts (cascade fan-out)
    mapping(bytes32 => uint256) public childCount;

    uint256 public count;
    uint256 public totalVolume;

    error NotRecorder();
    error DuplicateReceipt(bytes32 receiptId);
    error ZeroReceiptId();

    event RecorderSet(address indexed recorder, bool allowed);

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyRecorder() {
        if (!isRecorder[msg.sender] && msg.sender != owner()) revert NotRecorder();
        _;
    }

    /// @notice Grant/revoke a gateway recorder.
    function setRecorder(address recorder, bool allowed) external onlyOwner {
        isRecorder[recorder] = allowed;
        emit RecorderSet(recorder, allowed);
    }

    /// @inheritdoc IReceiptRegistry
    function recordReceipt(
        bytes32 receiptId,
        bytes32 parentId,
        address payer,
        address payee,
        address token,
        uint256 amount,
        bytes32 toolId
    ) external onlyRecorder {
        if (receiptId == bytes32(0)) revert ZeroReceiptId();
        if (_receipts[receiptId].exists) revert DuplicateReceipt(receiptId);

        _receipts[receiptId] = Receipt({
            parentId: parentId,
            payer: payer,
            payee: payee,
            token: token,
            amount: amount,
            toolId: toolId,
            timestamp: uint64(block.timestamp),
            exists: true
        });

        unchecked {
            count += 1;
            totalVolume += amount;
        }
        if (parentId != bytes32(0)) {
            unchecked {
                childCount[parentId] += 1;
            }
        }

        emit ReceiptRecorded(receiptId, parentId, payee, payer, token, amount, toolId);
    }

    /// @inheritdoc IReceiptRegistry
    function exists(bytes32 receiptId) external view returns (bool) {
        return _receipts[receiptId].exists;
    }

    /// @notice Full receipt record.
    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return _receipts[receiptId];
    }
}
