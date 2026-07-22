// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

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
/// @dev    Bids are EIP-712 typed signatures: the domain binds chainId + this contract,
///         so a bid can never replay on another chain or another deployment.
contract ToolAuction is Ownable2Step, EIP712 {
    using ECDSA for bytes32;

    uint256 public constant SCALE = 1e18;

    bytes32 public constant BID_TYPEHASH = keccak256("Bid(uint256 requestId,uint256 price)");

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
    /// @dev requestId => bidder => 1-based slot in bids[requestId] (0 = no bid yet). Dedups
    ///      bidders so the bids array is bounded by unique participants — a replayed signature
    ///      cannot inflate it, and `clear`'s O(n) loop stays gas-bounded.
    mapping(uint256 => mapping(address => uint256)) public bidSlot;

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

    constructor(address initialOwner) Ownable(initialOwner) EIP712("tiagoh ToolAuction", "1") {}

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

    /// @notice The EIP-712 digest a bidder signs to authorize a price bid.
    function bidHash(uint256 requestId, uint256 price) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BID_TYPEHASH, requestId, price)));
    }

    /// @notice Submit a signed bid; the bidder is recovered from `signature` (so a relayer
    ///         can post it). Price must be within the request's `maxPrice`. One slot per bidder:
    ///         a bidder may only lower their standing bid (reverse auction), so replaying an old
    ///         higher-priced signature is a no-op and can never inflate the bid array or raise a
    ///         bidder's price against their will. (OZ `ECDSA.recover` reverts on a bad signature,
    ///         so a recovered bidder is always a real address.)
    function submitBid(uint256 requestId, uint256 price, bytes calldata signature) external {
        Request storage r = requests[requestId];
        if (!r.open) revert RequestClosed();
        if (block.timestamp > r.deadline) revert BiddingEnded();
        if (price > r.maxPrice) revert PriceTooHigh();

        address bidder = bidHash(requestId, price).recover(signature);

        uint256 slot = bidSlot[requestId][bidder];
        if (slot == 0) {
            bids[requestId].push(Bid({bidder: bidder, price: price}));
            bidSlot[requestId][bidder] = bids[requestId].length;
        } else {
            Bid storage existing = bids[requestId][slot - 1];
            if (price < existing.price) existing.price = price;
        }
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
