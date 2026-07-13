// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IReputationRegistry
/// @notice Minimal read/write surface over the canonical ERC-8004 Reputation Registry
///         already deployed on GOAT. tiagoh's `ReputationScorer` stores this registry
///         address and can reference its raw signed-signal store while layering its own
///         aggregation on top (the ERC-8004 spec leaves scoring to the app layer).
interface IReputationRegistry {
    /// @notice The bound ERC-8004 Identity Registry.
    function getIdentityRegistry() external view returns (address);

    /// @notice Addresses that have left feedback for `agentId`.
    function getClients(uint256 agentId) external view returns (address[] memory);

    /// @notice Last feedback index a client wrote for an agent (0 if none).
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
}
