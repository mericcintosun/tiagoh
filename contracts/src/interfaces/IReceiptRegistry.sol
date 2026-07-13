// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IReceiptRegistry
/// @notice Minimal interface for anchoring settled x402 receipts with their cascade
///         `parentId`. Other tiagoh contracts (gateway recorders, cascade tooling)
///         depend only on this surface.
interface IReceiptRegistry {
    event ReceiptRecorded(
        bytes32 indexed receiptId,
        bytes32 indexed parentId,
        address indexed payee,
        address payer,
        address token,
        uint256 amount,
        bytes32 toolId
    );

    function recordReceipt(
        bytes32 receiptId,
        bytes32 parentId,
        address payer,
        address payee,
        address token,
        uint256 amount,
        bytes32 toolId
    ) external;

    function exists(bytes32 receiptId) external view returns (bool);

    function count() external view returns (uint256);

    function totalVolume() external view returns (uint256);
}
