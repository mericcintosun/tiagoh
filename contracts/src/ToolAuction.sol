// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @dev Minimal reputation read used for reputation-weighted clearing. The bond-capped form is
///      deliberate: an unbonded Sybil scores zero, so it cannot outbid on reputation either.
interface IReputationScorer {
    function scoreOfSeller(address subject, bytes32 toolId) external view returns (uint256);
}

/// @title ToolAuction
/// @notice Live reverse auctions for a capability request (PRD §5.5). A buyer opens a request;
///         competing tools post a bid bond and submit signed price bids; `clear` picks the
///         winner by policy (lowest price, or reputation-weighted best value).
///
/// @dev    WHY BIDS COST SOMETHING. A reverse auction with free bids has an obvious dominant
///         strategy: a Sybil bids zero, wins every `LOWEST_PRICE` request, and then simply does
///         not deliver. Nothing on-chain punished that before, and "reputation handles it
///         off-chain" is not an answer when the Sybil is a fresh address with no reputation to
///         lose.
///
///         So bidding requires a **bid bond**, and winning creates an **obligation**:
///         - every bidder posts `bidBond` before their signed bid is accepted;
///         - losers reclaim their bond as soon as the request clears;
///         - the winner's bond stays locked until the buyer confirms delivery;
///         - if the winner does not deliver within `serviceWindow`, the buyer takes the bond.
///
///         Liveness: if the buyer never clears the request, every bidder can reclaim their bond
///         once `deadline + serviceWindow` has passed, so an abandoned auction cannot strand
///         anyone's capital.
///
///         Bids are EIP-712 typed signatures: the domain binds chainId + this contract, so a bid
///         can never replay on another chain or another deployment.
contract ToolAuction is Ownable2Step, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    uint256 public constant SCALE = 1e18;

    bytes32 public constant BID_TYPEHASH = keccak256("Bid(uint256 requestId,uint256 price)");

    enum Policy {
        LOWEST_PRICE,
        REPUTATION_WEIGHTED
    }

    enum Obligation {
        NONE,
        PENDING, // cleared, winner owes delivery
        DELIVERED,
        DEFAULTED
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
        uint256 serviceDeadline;
        Obligation obligation;
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
    /// @dev requestId => bidder => bid bond still held by this contract
    mapping(uint256 => mapping(address => uint256)) public bidBondOf;

    IERC20 public immutable bondToken;
    IReputationScorer public reputationScorer;
    /// @notice Stake a bidder must post before bidding (0 disables, testnet only).
    uint256 public bidBond;
    /// @notice How long the winner has to deliver before the buyer may claim their bond.
    uint256 public serviceWindow = 1 days;

    error NotBuyer();
    error BiddingOpen();
    error RequestClosed();
    error RequestStillOpen();
    error BiddingEnded();
    error PriceTooHigh();
    error NoBids();
    error AlreadySettled();
    error NoBidBond();
    error BidBondAlreadyPosted();
    error BondLocked();
    error NoBondToRefund();
    error NotPending();
    error ServiceWindowOpen();
    error ServiceWindowClosed();
    error ZeroDuration();

    event ReputationScorerSet(address indexed scorer);
    event BidBondSet(uint256 amount);
    event ServiceWindowSet(uint256 window);
    event RequestOpened(
        uint256 indexed requestId,
        address indexed buyer,
        bytes32 indexed capabilityId,
        uint256 maxPrice,
        uint256 deadline,
        Policy policy
    );
    event BidBondPosted(uint256 indexed requestId, address indexed bidder, uint256 amount);
    event BidBondRefunded(uint256 indexed requestId, address indexed bidder, uint256 amount);
    event BidSubmitted(uint256 indexed requestId, address indexed bidder, uint256 price);
    event Winner(uint256 indexed requestId, address indexed bidder, uint256 price);
    event Delivered(uint256 indexed requestId, address indexed winner);
    event Defaulted(uint256 indexed requestId, address indexed winner, uint256 bondToBuyer);
    event Settled(uint256 indexed requestId, address indexed winner, uint256 price);

    constructor(address initialOwner, address bondToken_)
        Ownable(initialOwner)
        EIP712("tiagoh ToolAuction", "1")
    {
        bondToken = IERC20(bondToken_);
    }

    function setReputationScorer(address scorer) external onlyOwner {
        reputationScorer = IReputationScorer(scorer);
        emit ReputationScorerSet(scorer);
    }

    function setBidBond(uint256 amount) external onlyOwner {
        bidBond = amount;
        emit BidBondSet(amount);
    }

    function setServiceWindow(uint256 window) external onlyOwner {
        if (window == 0) revert ZeroDuration();
        serviceWindow = window;
        emit ServiceWindowSet(window);
    }

    /// @notice Open a reverse-auction request.
    function openRequest(bytes32 capabilityId, uint256 maxPrice, uint256 duration, Policy policy)
        external
        returns (uint256 requestId)
    {
        if (duration == 0) revert ZeroDuration();
        uint256 deadline = block.timestamp + duration;
        requestId = ++requestCount;
        Request storage r = requests[requestId];
        r.buyer = msg.sender;
        r.capabilityId = capabilityId;
        r.maxPrice = maxPrice;
        r.deadline = deadline;
        r.policy = policy;
        r.open = true;
        emit RequestOpened(requestId, msg.sender, capabilityId, maxPrice, deadline, policy);
    }

    /// @notice Post the bid bond for a request. Separate from `submitBid` so bids can still be
    ///         relayed (the signature is what authorizes the price) while the stake itself
    ///         demonstrably comes from the bidder.
    function postBidBond(uint256 requestId) external nonReentrant {
        Request storage r = requests[requestId];
        if (!r.open) revert RequestClosed();
        if (block.timestamp > r.deadline) revert BiddingEnded();
        if (bidBondOf[requestId][msg.sender] != 0) revert BidBondAlreadyPosted();

        uint256 amount = bidBond;
        bidBondOf[requestId][msg.sender] = amount;
        if (amount > 0) {
            bondToken.safeTransferFrom(msg.sender, address(this), amount);
        }
        emit BidBondPosted(requestId, msg.sender, amount);
    }

    /// @notice The EIP-712 digest a bidder signs to authorize a price bid.
    function bidHash(uint256 requestId, uint256 price) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BID_TYPEHASH, requestId, price)));
    }

    /// @notice Submit a signed bid; the bidder is recovered from `signature` (so a relayer can
    ///         post it) and must already have posted a bid bond. One slot per bidder: a bidder
    ///         may only lower their standing bid (reverse auction), so replaying an old
    ///         higher-priced signature is a no-op and can never inflate the bid array or raise a
    ///         bidder's price against their will. (OZ `ECDSA.recover` reverts on a bad signature,
    ///         so a recovered bidder is always a real address.)
    function submitBid(uint256 requestId, uint256 price, bytes calldata signature) external {
        Request storage r = requests[requestId];
        if (!r.open) revert RequestClosed();
        if (block.timestamp > r.deadline) revert BiddingEnded();
        if (price > r.maxPrice) revert PriceTooHigh();

        address bidder = bidHash(requestId, price).recover(signature);
        // Skin in the game: no stake, no bid. This is what stops a zero-price no-show Sybil.
        if (bidBond != 0 && bidBondOf[requestId][bidder] == 0) revert NoBidBond();

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

    /// @notice Clear the auction, selecting the winner per the request policy, and start the
    ///         winner's delivery obligation.
    /// @dev    The buyer may clear at any time; once bidding has closed **anyone** may clear.
    ///         There is no discretion in clearing — the winner is a pure function of the bids and
    ///         the policy — so a permissionless keeper cannot skew the outcome, it can only stop
    ///         an inattentive buyer from leaving bidders' bonds locked. The owner deliberately
    ///         has no say here: letting it clear early would be real power, because *when* an
    ///         auction closes decides which bids are in it.
    function clear(uint256 requestId) external returns (address winner, uint256 price) {
        Request storage r = requests[requestId];
        if (!r.open) revert RequestClosed();
        if (msg.sender != r.buyer && block.timestamp <= r.deadline) revert BiddingOpen();

        Bid[] storage rb = bids[requestId];
        uint256 n = rb.length;
        if (n == 0) revert NoBids();

        uint256 bestValue = type(uint256).max; // lower is better
        uint256 bestIdx;
        for (uint256 i; i < n; ++i) {
            uint256 value = _effectiveValue(r.policy, r.capabilityId, rb[i]);
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
        r.obligation = Obligation.PENDING;
        r.serviceDeadline = block.timestamp + serviceWindow;
        emit Winner(requestId, winner, price);
    }

    /// @dev Lower effective value wins. Reputation reduces the effective price so a
    ///      higher-reputation bidder can win at a slightly higher sticker price. The score is
    ///      capped by the bidder's live bond for this capability, so reputation cannot be
    ///      conjured by a fresh address.
    function _effectiveValue(Policy policy, bytes32 capabilityId, Bid storage b)
        internal
        view
        returns (uint256)
    {
        if (policy == Policy.LOWEST_PRICE || address(reputationScorer) == address(0)) {
            return b.price;
        }
        uint256 score = reputationScorer.scoreOfSeller(b.bidder, capabilityId);
        // effective = price * SCALE / (SCALE + score)
        return (b.price * SCALE) / (SCALE + score);
    }

    /// @notice Buyer confirms the winner delivered; the winner's bid bond is unlocked.
    function confirmDelivery(uint256 requestId) external {
        Request storage r = requests[requestId];
        if (r.obligation != Obligation.PENDING) revert NotPending();
        if (msg.sender != r.buyer) revert NotBuyer();
        r.obligation = Obligation.DELIVERED;
        emit Delivered(requestId, r.winner);
    }

    /// @notice The winner did not deliver inside the service window: the buyer takes their bid
    ///         bond. This is the on-chain consequence that makes a zero-price bid a real
    ///         commitment rather than a free option.
    function claimNoShow(uint256 requestId) external nonReentrant {
        Request storage r = requests[requestId];
        if (r.obligation != Obligation.PENDING) revert NotPending();
        if (msg.sender != r.buyer) revert NotBuyer();
        if (block.timestamp <= r.serviceDeadline) revert ServiceWindowOpen();

        r.obligation = Obligation.DEFAULTED;
        uint256 amount = bidBondOf[requestId][r.winner];
        bidBondOf[requestId][r.winner] = 0;
        if (amount > 0) {
            bondToken.safeTransfer(r.buyer, amount);
        }
        emit Defaulted(requestId, r.winner, amount);
    }

    /// @notice Reclaim a bid bond. Losers may withdraw as soon as the request clears; the winner
    ///         only after they are confirmed delivered. If the buyer abandoned the auction
    ///         without clearing it, every bidder may withdraw once `deadline + serviceWindow`
    ///         has passed, so nobody's capital is stranded by an inattentive buyer.
    function refundBidBond(uint256 requestId) external nonReentrant {
        Request storage r = requests[requestId];
        uint256 amount = bidBondOf[requestId][msg.sender];
        if (amount == 0) revert NoBondToRefund();

        if (r.open) {
            // Never cleared: only unlock once the auction is definitively abandoned.
            if (block.timestamp <= r.deadline + serviceWindow) revert BondLocked();
        } else if (msg.sender == r.winner && r.obligation == Obligation.PENDING) {
            revert BondLocked();
        }

        bidBondOf[requestId][msg.sender] = 0;
        bondToken.safeTransfer(msg.sender, amount);
        emit BidBondRefunded(requestId, msg.sender, amount);
    }

    /// @notice Settlement hook: mark the cleared request settled once the winner has been paid
    ///         through the cascade / revenue-split rails.
    function settle(uint256 requestId) external {
        Request storage r = requests[requestId];
        if (r.open) revert RequestStillOpen();
        if (r.settled) revert AlreadySettled();
        if (msg.sender != r.buyer) revert NotBuyer();
        r.settled = true;
        emit Settled(requestId, r.winner, r.winningPrice);
    }

    function bidCount(uint256 requestId) external view returns (uint256) {
        return bids[requestId].length;
    }
}
