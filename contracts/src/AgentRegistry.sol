// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @dev Minimal ERC-8004 Identity Registry surface used to gate agent binding.
interface IIdentityRegistry {
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
}

/// @title AgentRegistry
/// @notice Binds an operator to an ERC-8004 agent id and enforces capped spend delegation
///         (PRD §5.3). A parent grants a child a spending `cap`; `spend` draws it down and
///         reverts past the cap. Delegation is open (any address may delegate to any
///         other), so chains of delegate/spend form an auditable, sub-delegated agent
///         supply chain — an agent cannot be drained past its allowance at any depth.
/// @dev    On GOAT this pairs with x402 DELEGATE settlement + ERC-4337 session keys as the
///         off-chain enforcement point; this contract is the on-chain allowance ledger.
contract AgentRegistry is Ownable2Step {
    struct Delegation {
        uint256 cap;
        uint256 spent;
    }

    /// @notice Optional ERC-8004 Identity Registry gating `bindOperator`.
    address public identityRegistry;

    /// @dev agentId => operator
    mapping(uint256 => address) public operatorOf;
    /// @dev operator => agentId
    mapping(address => uint256) public agentIdOf;
    /// @dev parent => child => Delegation
    mapping(address => mapping(address => Delegation)) public delegations;

    error NotAuthorizedForAgent();
    error AgentAlreadyBound();
    error OperatorAlreadyBound();
    error ZeroAgentId();
    error CapBelowSpent();
    error CapExceeded(address parent, address child, uint256 remaining, uint256 requested);

    event IdentityRegistrySet(address indexed registry);
    event OperatorBound(uint256 indexed agentId, address indexed operator);
    event Delegated(address indexed parent, address indexed child, uint256 cap);
    event Spent(address indexed parent, address indexed child, uint256 amount, uint256 totalSpent);
    event Revoked(address indexed parent, address indexed child);

    constructor(address identityRegistry_, address initialOwner) Ownable(initialOwner) {
        identityRegistry = identityRegistry_;
        emit IdentityRegistrySet(identityRegistry_);
    }

    function setIdentityRegistry(address registry) external onlyOwner {
        identityRegistry = registry;
        emit IdentityRegistrySet(registry);
    }

    /// @notice Bind the caller as operator of `agentId`. If an Identity Registry is set,
    ///         the caller must be authorized/owner of that ERC-8004 agent.
    function bindOperator(uint256 agentId) external {
        if (agentId == 0) revert ZeroAgentId();
        if (operatorOf[agentId] != address(0)) revert AgentAlreadyBound();
        // One operator, one agent: a second bind would silently orphan the reverse map.
        if (agentIdOf[msg.sender] != 0) revert OperatorAlreadyBound();
        if (identityRegistry != address(0)) {
            if (!IIdentityRegistry(identityRegistry).isAuthorizedOrOwner(msg.sender, agentId)) {
                revert NotAuthorizedForAgent();
            }
        }
        operatorOf[agentId] = msg.sender;
        agentIdOf[msg.sender] = agentId;
        emit OperatorBound(agentId, msg.sender);
    }

    /// @notice Grant/replace a spend cap for `child`. Cap cannot drop below what was
    ///         already spent.
    function delegate(address child, uint256 cap) external {
        Delegation storage d = delegations[msg.sender][child];
        if (cap < d.spent) revert CapBelowSpent();
        d.cap = cap;
        emit Delegated(msg.sender, child, cap);
    }

    /// @notice Record `child` spending `amount` against the caller's delegation; reverts
    ///         past the cap. Sub-delegation: `child` can itself `delegate` onward, and its
    ///         own spends are gated the same way one level down.
    function spend(address child, uint256 amount) external {
        Delegation storage d = delegations[msg.sender][child];
        uint256 rem = d.cap - d.spent;
        if (amount > rem) {
            revert CapExceeded(msg.sender, child, rem, amount);
        }
        d.spent += amount;
        emit Spent(msg.sender, child, amount, d.spent);
    }

    /// @notice Revoke a child's remaining allowance (caps it at what was already spent).
    function revoke(address child) external {
        Delegation storage d = delegations[msg.sender][child];
        d.cap = d.spent;
        emit Revoked(msg.sender, child);
    }

    /// @notice Remaining spendable allowance from `parent` to `child`.
    function remaining(address parent, address child) external view returns (uint256) {
        Delegation storage d = delegations[parent][child];
        return d.cap - d.spent;
    }
}
