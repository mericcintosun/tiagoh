// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ToolAuction} from "../src/ToolAuction.sol";

contract MockScorer {
    mapping(address => uint256) public scores;

    function set(address subject, uint256 score) external {
        scores[subject] = score;
    }

    function scoreOf(address subject) external view returns (uint256) {
        return scores[subject];
    }
}

contract ToolAuctionTest is Test {
    ToolAuction auction;
    MockScorer scorer;

    uint256 constant B1_PK = 0xB1D1;
    uint256 constant B2_PK = 0xB1D2;
    address b1;
    address b2;
    address buyer = address(0xCAFE);

    bytes32 constant CAP = keccak256("capability:market-data");

    function setUp() public {
        auction = new ToolAuction(address(this));
        scorer = new MockScorer();
        b1 = vm.addr(B1_PK);
        b2 = vm.addr(B2_PK);
    }

    /// @dev Bids are EIP-712 typed digests (chainId + contract bound).
    function _bid(uint256 pk, uint256 requestId, uint256 price) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, auction.bidHash(requestId, price));
        return abi.encodePacked(r, s, v);
    }

    function test_lowestPrice_wins() public {
        vm.prank(buyer);
        uint256 id = auction.openRequest(CAP, 100e6, 1 days, ToolAuction.Policy.LOWEST_PRICE);

        auction.submitBid(id, 80e6, _bid(B1_PK, id, 80e6));
        auction.submitBid(id, 50e6, _bid(B2_PK, id, 50e6));
        assertEq(auction.bidCount(id), 2);

        vm.prank(buyer);
        (address winner, uint256 price) = auction.clear(id);
        assertEq(winner, b2);
        assertEq(price, 50e6);
    }

    function test_bid_overMaxPrice_reverts() public {
        vm.prank(buyer);
        uint256 id = auction.openRequest(CAP, 100e6, 1 days, ToolAuction.Policy.LOWEST_PRICE);
        bytes memory sig = _bid(B1_PK, id, 120e6);
        vm.expectRevert(ToolAuction.PriceTooHigh.selector);
        auction.submitBid(id, 120e6, sig);
    }

    function test_bid_afterDeadline_reverts() public {
        vm.prank(buyer);
        uint256 id = auction.openRequest(CAP, 100e6, 1 hours, ToolAuction.Policy.LOWEST_PRICE);
        bytes memory sig = _bid(B1_PK, id, 50e6);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(ToolAuction.BiddingEnded.selector);
        auction.submitBid(id, 50e6, sig);
    }

    function test_reputationWeighted_prefersReputableBidder() public {
        auction.setReputationScorer(address(scorer));
        // b1 is much more reputable; b2 is unknown but slightly cheaper.
        scorer.set(b1, 25e16); // shifts b1's effective price by /1.25
        scorer.set(b2, 0);

        vm.prank(buyer);
        uint256 id = auction.openRequest(CAP, 100e6, 1 days, ToolAuction.Policy.REPUTATION_WEIGHTED);
        auction.submitBid(id, 100e6, _bid(B1_PK, id, 100e6)); // effective 80e6
        auction.submitBid(id, 90e6, _bid(B2_PK, id, 90e6)); // effective 90e6

        vm.prank(buyer);
        (address winner, uint256 price) = auction.clear(id);
        assertEq(winner, b1, "reputable bidder wins at a higher sticker price");
        assertEq(price, 100e6, "winner is paid the sticker price");
    }

    function test_clear_onlyBuyerOrOwner() public {
        vm.prank(buyer);
        uint256 id = auction.openRequest(CAP, 100e6, 1 days, ToolAuction.Policy.LOWEST_PRICE);
        auction.submitBid(id, 50e6, _bid(B1_PK, id, 50e6));
        vm.prank(address(0xBAD));
        vm.expectRevert(ToolAuction.NotBuyer.selector);
        auction.clear(id);
    }

    function test_settle_marksSettledOnce() public {
        vm.prank(buyer);
        uint256 id = auction.openRequest(CAP, 100e6, 1 days, ToolAuction.Policy.LOWEST_PRICE);
        auction.submitBid(id, 50e6, _bid(B1_PK, id, 50e6));
        vm.startPrank(buyer);
        auction.clear(id);
        auction.settle(id);
        vm.expectRevert(ToolAuction.AlreadySettled.selector);
        auction.settle(id);
        vm.stopPrank();
    }
}
