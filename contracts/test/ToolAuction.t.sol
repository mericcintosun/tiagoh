// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ToolAuction} from "../src/ToolAuction.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract MockScorer {
    mapping(address => mapping(bytes32 => uint256)) public scores;

    function set(address subject, bytes32 toolId, uint256 score) external {
        scores[subject][toolId] = score;
    }

    function scoreOfSeller(address subject, bytes32 toolId) external view returns (uint256) {
        return scores[subject][toolId];
    }
}

contract ToolAuctionTest is Test {
    ToolAuction auction;
    MockScorer scorer;
    MockERC20 token;

    uint256 constant B1_PK = 0xB1D1;
    uint256 constant B2_PK = 0xB1D2;
    address b1;
    address b2;
    address buyer = address(0xCAFE);

    bytes32 constant CAP = keccak256("capability:market-data");
    uint256 constant BID_BOND = 10e6;

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        auction = new ToolAuction(address(this), address(token));
        scorer = new MockScorer();
        b1 = vm.addr(B1_PK);
        b2 = vm.addr(B2_PK);

        auction.setBidBond(BID_BOND);

        token.mint(b1, 1_000e6);
        token.mint(b2, 1_000e6);
        vm.prank(b1);
        token.approve(address(auction), type(uint256).max);
        vm.prank(b2);
        token.approve(address(auction), type(uint256).max);
    }

    /// @dev Bids are EIP-712 typed digests (chainId + contract bound).
    function _bid(uint256 pk, uint256 requestId, uint256 price)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, auction.bidHash(requestId, price));
        return abi.encodePacked(r, s, v);
    }

    function _open(ToolAuction.Policy policy) internal returns (uint256 id) {
        vm.prank(buyer);
        id = auction.openRequest(CAP, 100e6, 1 days, policy);
    }

    function _postAndBid(address bidder, uint256 pk, uint256 id, uint256 price) internal {
        vm.prank(bidder);
        auction.postBidBond(id);
        auction.submitBid(id, price, _bid(pk, id, price)); // relayed
    }

    // ── clearing ─────────────────────────────────────────────────────────────

    function test_lowestPrice_wins() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);

        _postAndBid(b1, B1_PK, id, 80e6);
        _postAndBid(b2, B2_PK, id, 50e6);
        assertEq(auction.bidCount(id), 2);

        vm.prank(buyer);
        (address winner, uint256 price) = auction.clear(id);
        assertEq(winner, b2);
        assertEq(price, 50e6);
    }

    function test_bid_overMaxPrice_reverts() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        vm.prank(b1);
        auction.postBidBond(id);
        bytes memory sig = _bid(B1_PK, id, 120e6);
        vm.expectRevert(ToolAuction.PriceTooHigh.selector);
        auction.submitBid(id, 120e6, sig);
    }

    function test_bid_afterDeadline_reverts() public {
        vm.prank(buyer);
        uint256 id = auction.openRequest(CAP, 100e6, 1 hours, ToolAuction.Policy.LOWEST_PRICE);
        vm.prank(b1);
        auction.postBidBond(id);
        bytes memory sig = _bid(B1_PK, id, 50e6);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(ToolAuction.BiddingEnded.selector);
        auction.submitBid(id, 50e6, sig);
    }

    function test_reputationWeighted_prefersReputableBidder() public {
        auction.setReputationScorer(address(scorer));
        // b1 is much more reputable; b2 is unknown but slightly cheaper.
        scorer.set(b1, CAP, 25e16); // shifts b1's effective price by /1.25
        scorer.set(b2, CAP, 0);

        uint256 id = _open(ToolAuction.Policy.REPUTATION_WEIGHTED);
        _postAndBid(b1, B1_PK, id, 100e6); // effective 80e6
        _postAndBid(b2, B2_PK, id, 90e6); // effective 90e6

        vm.prank(buyer);
        (address winner, uint256 price) = auction.clear(id);
        assertEq(winner, b1, "reputable bidder wins at a higher sticker price");
        assertEq(price, 100e6, "winner is paid the sticker price");
    }

    /// @dev The owner has no say in *when* an auction closes — that would decide which bids are
    ///      in it. Before the deadline only the buyer may clear.
    function test_clear_beforeDeadline_isBuyerOnly() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 50e6);

        vm.prank(address(0xBAD));
        vm.expectRevert(ToolAuction.BiddingOpen.selector);
        auction.clear(id);

        // `address(this)` is the contract owner in this suite.
        vm.expectRevert(ToolAuction.BiddingOpen.selector);
        auction.clear(id);
    }

    /// @dev Once bidding has closed the outcome is a pure function of the bids, so anyone may
    ///      clear — which is what stops an inattentive buyer from locking up bidders' bonds.
    function test_clear_afterDeadline_isPermissionlessButDeterministic() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 80e6);
        _postAndBid(b2, B2_PK, id, 50e6);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(address(0xBAD));
        (address winner, uint256 price) = auction.clear(id);
        assertEq(winner, b2, "a keeper cannot change who wins");
        assertEq(price, 50e6);
    }

    function test_settle_isBuyerOnly() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 50e6);
        vm.prank(buyer);
        auction.clear(id);

        vm.expectRevert(ToolAuction.NotBuyer.selector); // owner is not the buyer
        auction.settle(id);
    }

    function test_settle_marksSettledOnce() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 50e6);
        vm.startPrank(buyer);
        auction.clear(id);
        auction.settle(id);
        vm.expectRevert(ToolAuction.AlreadySettled.selector);
        auction.settle(id);
        vm.stopPrank();
    }

    // ── bid bonds + the winner's obligation ──────────────────────────────────

    /// @dev The core fix: a zero-price bid used to be a free option. Now it costs a stake.
    function test_submitBid_requiresABidBond() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        bytes memory sig = _bid(B1_PK, id, 0); // the classic zero-price Sybil
        vm.expectRevert(ToolAuction.NoBidBond.selector);
        auction.submitBid(id, 0, sig);
    }

    function test_postBidBond_pullsStakeOnce() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        vm.startPrank(b1);
        auction.postBidBond(id);
        assertEq(auction.bidBondOf(id, b1), BID_BOND, "stake held");
        assertEq(token.balanceOf(b1), 1_000e6 - BID_BOND, "pulled from the bidder");

        vm.expectRevert(ToolAuction.BidBondAlreadyPosted.selector);
        auction.postBidBond(id);
        vm.stopPrank();
    }

    function test_loserReclaimsBondOnceCleared() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 80e6);
        _postAndBid(b2, B2_PK, id, 50e6);
        vm.prank(buyer);
        auction.clear(id); // b2 wins

        vm.prank(b1);
        auction.refundBidBond(id);
        assertEq(token.balanceOf(b1), 1_000e6, "loser made whole");
    }

    function test_winnerBondIsLockedUntilDeliveryConfirmed() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 50e6);
        vm.prank(buyer);
        auction.clear(id);

        vm.prank(b1);
        vm.expectRevert(ToolAuction.BondLocked.selector);
        auction.refundBidBond(id);

        vm.prank(buyer);
        auction.confirmDelivery(id);

        vm.prank(b1);
        auction.refundBidBond(id);
        assertEq(token.balanceOf(b1), 1_000e6, "returned after delivery");
    }

    /// @dev The consequence that makes the bid a commitment: no delivery, no bond back.
    function test_noShowWinnerForfeitsBondToBuyer() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 50e6);
        vm.prank(buyer);
        auction.clear(id);

        vm.startPrank(buyer);
        vm.expectRevert(ToolAuction.ServiceWindowOpen.selector);
        auction.claimNoShow(id);

        vm.warp(block.timestamp + 1 days + 1);
        auction.claimNoShow(id);
        vm.stopPrank();

        assertEq(token.balanceOf(buyer), BID_BOND, "buyer compensated");
        vm.prank(b1);
        vm.expectRevert(ToolAuction.NoBondToRefund.selector);
        auction.refundBidBond(id);
    }

    function test_claimNoShow_afterDelivery_reverts() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 50e6);
        vm.startPrank(buyer);
        auction.clear(id);
        auction.confirmDelivery(id);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(ToolAuction.NotPending.selector);
        auction.claimNoShow(id);
        vm.stopPrank();
    }

    function test_confirmDelivery_onlyBuyer() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 50e6);
        vm.prank(buyer);
        auction.clear(id);

        vm.prank(b1);
        vm.expectRevert(ToolAuction.NotBuyer.selector);
        auction.confirmDelivery(id);
    }

    /// @dev Liveness: an inattentive buyer who never clears must not strand bidders' capital.
    function test_abandonedAuctionReleasesBidBonds() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        _postAndBid(b1, B1_PK, id, 50e6);

        vm.startPrank(b1);
        vm.expectRevert(ToolAuction.BondLocked.selector);
        auction.refundBidBond(id);

        vm.warp(block.timestamp + 1 days + 1 days + 1); // deadline + serviceWindow
        auction.refundBidBond(id);
        vm.stopPrank();

        assertEq(token.balanceOf(b1), 1_000e6, "capital released");
    }

    function test_refundBidBond_withoutOne_reverts() public {
        uint256 id = _open(ToolAuction.Policy.LOWEST_PRICE);
        vm.prank(address(0xBAD));
        vm.expectRevert(ToolAuction.NoBondToRefund.selector);
        auction.refundBidBond(id);
    }
}
