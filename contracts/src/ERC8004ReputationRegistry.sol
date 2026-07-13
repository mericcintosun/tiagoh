// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ERC8004ReputationRegistry
/// @notice A self-contained ERC-8004 Reputation Registry. The canonical ERC-8004 registry is an
///         upgradeable ERC-721 identity stack that is not deployed on GOAT Testnet3, so tiagoh ships
///         this compact, dependency-free registry with the SAME `giveFeedback` external signature as
///         the reference implementation. That keeps the off-chain writer ABI identical, so pointing it
///         at the canonical registry (once live on GOAT mainnet) is an address swap, not a code change.
///
///         tiagoh feeds it real outcomes: a settled call becomes positive feedback, a dispute or a
///         quality-bond slash becomes negative feedback, each tagged and anchored to its receipt hash.
///         Reputation is therefore built from settlement facts, not self-reported marketing.
contract ERC8004ReputationRegistry {
    struct Feedback {
        int128 value; // signed fixed-point score
        uint8 valueDecimals; // decimals for `value` (<= 18)
        string tag1; // primary tag, e.g. "tiagoh"
        string tag2; // outcome tag, e.g. "success" | "dispute" | "slash"
        bool isRevoked;
    }

    int128 internal constant MAX_ABS_VALUE = int128(1_000_000) * int128(int256(1e18));

    // agentId => subject (the tool/agent this reputation is about)
    mapping(uint256 => address) public subjectOf;
    // subject => agentId (0 means unregistered)
    mapping(address => uint256) public agentOf;
    uint256 public agentCount;

    // agentId => client => feedbackIndex => Feedback
    mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) internal _feedback;
    // agentId => client => last written index (1-indexed)
    mapping(uint256 => mapping(address => uint64)) internal _lastIndex;
    // agentId => list of clients that have given feedback
    mapping(uint256 => address[]) internal _clients;
    mapping(uint256 => mapping(address => bool)) internal _clientExists;

    error AgentUnknown();
    error SelfFeedback();
    error ValueOutOfRange();
    error TooManyDecimals();
    error AlreadyRegistered();
    error ZeroSubject();
    error IndexOutOfBounds();
    error AlreadyRevoked();

    event AgentRegistered(uint256 indexed agentId, address indexed subject);
    // Field ordering mirrors the reference ERC-8004 Reputation Registry event.
    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);

    /// @notice Register a subject (a tool or agent address) and mint its ERC-8004 agent id.
    ///         Idempotent-friendly: reverts if the subject already has an id (read `agentOf` first).
    function registerAgent(address subject) external returns (uint256 agentId) {
        if (subject == address(0)) revert ZeroSubject();
        if (agentOf[subject] != 0) revert AlreadyRegistered();
        agentId = ++agentCount;
        subjectOf[agentId] = subject;
        agentOf[subject] = agentId;
        emit AgentRegistered(agentId, subject);
    }

    /// @notice Give feedback about an agent. Signature matches the canonical ERC-8004 registry so the
    ///         same client ABI works against either. The subject cannot rate itself.
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external returns (uint64 feedbackIndex) {
        if (subjectOf[agentId] == address(0)) revert AgentUnknown();
        if (subjectOf[agentId] == msg.sender) revert SelfFeedback();
        if (valueDecimals > 18) revert TooManyDecimals();
        if (value < -MAX_ABS_VALUE || value > MAX_ABS_VALUE) revert ValueOutOfRange();

        feedbackIndex = ++_lastIndex[agentId][msg.sender];
        _feedback[agentId][msg.sender][feedbackIndex] =
            Feedback({value: value, valueDecimals: valueDecimals, tag1: tag1, tag2: tag2, isRevoked: false});

        if (!_clientExists[agentId][msg.sender]) {
            _clients[agentId].push(msg.sender);
            _clientExists[agentId][msg.sender] = true;
        }
        emit NewFeedback(agentId, msg.sender, feedbackIndex, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        if (feedbackIndex == 0 || feedbackIndex > _lastIndex[agentId][msg.sender]) revert IndexOutOfBounds();
        Feedback storage fb = _feedback[agentId][msg.sender][feedbackIndex];
        if (fb.isRevoked) revert AlreadyRevoked();
        fb.isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    function readFeedback(uint256 agentId, address client, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked)
    {
        Feedback storage fb = _feedback[agentId][client][feedbackIndex];
        return (fb.value, fb.valueDecimals, fb.tag1, fb.tag2, fb.isRevoked);
    }

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    function clientCount(uint256 agentId) external view returns (uint256) {
        return _clients[agentId].length;
    }

    /// @notice Aggregate all non-revoked feedback for an agent, normalized to 18-decimal (WAD) fixed point.
    /// @return count      number of feedback entries counted
    /// @return sumWad     sum of values normalized to 18 decimals
    /// @return averageWad sumWad / count (0 when count is 0)
    function getSummary(uint256 agentId) external view returns (uint64 count, int256 sumWad, int256 averageWad) {
        address[] storage clients = _clients[agentId];
        for (uint256 i; i < clients.length; i++) {
            address client = clients[i];
            uint64 lastIdx = _lastIndex[agentId][client];
            for (uint64 j = 1; j <= lastIdx; j++) {
                Feedback storage fb = _feedback[agentId][client][j];
                if (fb.isRevoked) continue;
                int256 factor = int256(10 ** uint256(18 - fb.valueDecimals));
                sumWad += int256(fb.value) * factor;
                count++;
            }
        }
        averageWad = count == 0 ? int256(0) : sumWad / int256(uint256(count));
    }
}
