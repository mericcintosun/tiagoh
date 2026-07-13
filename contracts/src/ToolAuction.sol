// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev Minimal reputation read used for reputation-weighted clearing.
interface IReputationScorer {
    function scoreOf(address subject) external view returns (uint256);
}

/// @title ToolAuction
/// @notice Live reverse auctions for a capability request (PRD §5.5 — whitespace across
///         the x402 ecosystem). A buyer opens a request; competing tools submit signed
///         price bids; `clear` picks the winner by policy (lowest price, or
///         reputation-weighted best value using the ReputationScorer). The winner settles
///         through tiagoh's existing cascade / revenue-split rails via the `settle` hook.
contract ToolAuction is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public constant SCALE = 1e18;

    enum Policy {
        LOWEST_PRICE,
        REPUTATION_WEIGHTED
    }

    struct Request {
        address buyer;
        bytes32 capabilityId;
        uint256 maxPrice;
        uint256 deadline;
        Policy policy;
        bool open;
        bool settled;
        address winner;
        uint256 winningPrice;
    }

    struct Bid {
        address bidder;
        uint256 price;
    }

    uint256 public requestCount;
    mapping(uint256 => Request) public requests;
    mapping(uint256 => Bid[]) public bids;

    IReputationScorer public reputationScorer;

    error NotBuyer();
    error RequestClosed();
    error RequestStillOpen();
    error BiddingEnded();
    error PriceTooHigh();
    error BadSignature();
    error NoBids();
    error AlreadySettled();

    event ReputationScorerSet(address indexed scorer);
    event RequestOpened(
        uint256 indexed requestId,
        address indexed buyer,
        bytes32 indexed capabilityId,
        uint256 maxPrice,
        uint256 deadline,
        Policy policy
    );
    event BidSubmitted(uint256 indexed requestId, address indexed bidder, uint256 price);
    event Winner(uint256 indexed requestId, address indexed bidder, uint256 price);
    event Settled(uint256 indexed requestId, address indexed winner, uint256 price);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setReputationScorer(address scorer) external onlyOwner {
        reputationScorer = IReputationScorer(scorer);
        emit ReputationScorerSet(scorer);
    }

    /// @notice Open a reverse-auction request.
    function openRequest(bytes32 capabilityId, uint256 maxPrice, uint256 duration, Policy policy)
        external
        returns (uint256 requestId)
    {
        requestId = ++requestCount;
        requests[requestId] = Request({
            buyer: msg.sender,
            capabilityId: capabilityId,
            maxPrice: maxPrice,
            deadline: block.timestamp + duration,
            policy: policy,
            open: true,
            settled: false,
            winner: address(0),
            winningPrice: 0
        });
        emit RequestOpened(
            requestId, msg.sender, capabilityId, maxPrice, block.timestamp + duration, policy
        );
    }

    /// @notice The message a bidder signs to authorize a price bid.
    function bidHash(uint256 requestId, uint256 price) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), requestId, price));
    }

    /// @notice Submit a signed bid; the bidder is recovered from `signature` (so a relayer
    ///         can post it). Price must be within the request's `maxPrice`.
    function submitBid(uint256 requestId, uint256 price, bytes calldata signature) external {
        Request storage r = requests[requestId];
        if (!r.open) revert RequestClosed();
        if (block.timestamp > r.deadline) revert BiddingEnded();
        if (price > r.maxPrice) revert PriceTooHigh();

        bytes32 digest = bidHash(requestId, price).toEthSignedMessageHash();
        address bidder = digest.recover(signature);
        if (bidder == address(0)) revert BadSignature();

        bids[requestId].push(Bid({bidder: bidder, price: price}));
        emit BidSubmitted(requestId, bidder, price);
    }

    /// @notice Clear the auction, selecting the winner per the request policy.
    function clear(uint256 requestId) external returns (address winner, uint256 price) {
        Request storage r = requests[requestId];
        if (!r.open) revert RequestClosed();
        if (msg.sender != r.buyer && msg.sender != owner()) revert NotBuyer();

        Bid[] storage rb = bids[requestId];
        uint256 n = rb.length;
        if (n == 0) revert NoBids();

        uint256 bestValue = type(uint256).max; // lower is better
        uint256 bestIdx;
        for (uint256 i; i < n; ++i) {
            uint256 value = _effectiveValue(r.policy, rb[i]);
            if (value < bestValue) {
                bestValue = value;
                bestIdx = i;
            }
        }

        winner = rb[bestIdx].bidder;
        price = rb[bestIdx].price;
        r.open = false;
        r.winner = winner;
        r.winningPrice = price;
        emit Winner(requestId, winner, price);
    }

    /// @dev Lower effective value wins. Reputation reduces the effective price so a
    ///      higher-reputation bidder can win at a slightly higher sticker price.
    function _effectiveValue(Policy policy, Bid storage b) internal view returns (uint256) {
        if (policy == Policy.LOWEST_PRICE || address(reputationScorer) == address(0)) {
            return b.price;
        }
        uint256 score = reputationScorer.scoreOf(b.bidder);
        // effective = price * SCALE / (SCALE + score)
        return (b.price * SCALE) / (SCALE + score);
    }

    /// @notice Settlement hook: mark the cleared request settled once the winner has been
    ///         paid through the cascade / revenue-split rails.
    function settle(uint256 requestId) external {
        Request storage r = requests[requestId];
        if (r.open) revert RequestStillOpen();
        if (r.settled) revert AlreadySettled();
        if (msg.sender != r.buyer && msg.sender != owner()) revert NotBuyer();
        r.settled = true;
        emit Settled(requestId, r.winner, r.winningPrice);
    }

    function bidCount(uint256 requestId) external view returns (uint256) {
        return bids[requestId].length;
    }
}
