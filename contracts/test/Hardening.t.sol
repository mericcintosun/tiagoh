// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {ERC8004ReputationRegistry} from "../src/ERC8004ReputationRegistry.sol";
import {FeedbackAllowlist} from "../src/FeedbackAllowlist.sol";
import {ToolAuction} from "../src/ToolAuction.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev A token that reverts when transferring OUT (refund), but accepts transferIn (deposit).
///      Models a "poison" escrow whose refund reverts to grief an atomic cascade unwind.
contract PoisonToken is MockERC20 {
    constructor() MockERC20("POISON", "PSN", 6) {}

    function transfer(address, uint256) public pure override returns (bool) {
        revert("poison: no transfer out");
    }
}

/// @dev A 10%-fee-on-transfer token: the recipient receives 90% of `amount`.
contract FeeToken is MockERC20 {
    constructor() MockERC20("FEE", "FEE", 6) {}

    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 net = (amount * 9) / 10;
        return super.transfer(to, net);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 net = (amount * 9) / 10;
        return super.transferFrom(from, to, net);
    }
}

contract EscrowHardeningTest is Test {
    EscrowVault internal escrow;
    MockERC20 internal token;
    address internal owner = address(0xA0);
    address internal arbiter = address(0xAB);
    address internal buyer = address(0xB0);
    address internal attacker = address(0xBAD);
    address internal seller = address(0x5E);
    bytes32 internal constant CASCADE = keccak256("cascade-1");
    bytes32 internal constant TOOL = keccak256("tool");

    function setUp() public {
        escrow = new EscrowVault(owner);
        token = new MockERC20("USD", "USD", 6);
        vm.prank(owner);
        escrow.setArbiter(arbiter, true);
    }

    /// @dev M-4/Finding2, first line of defence: an outsider can no longer inject anything into
    ///      someone else's cascade at all. The old contract let anyone tag any cascadeId, and
    ///      because the unwind refunded each escrow to its own payer, the attacker even got
    ///      their poison deposit back — a free way to bloat a victim's unwind.
    function test_unwindCascade_outsiderCannotInjectPoisonEscrow() public {
        token.mint(buyer, 100e6);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(buyer);
        escrow.deposit(seller, address(token), 100e6, 1 days, CASCADE, TOOL);

        PoisonToken poison = new PoisonToken();
        poison.mint(attacker, 50e6);
        vm.prank(attacker);
        poison.approve(address(escrow), type(uint256).max);

        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(EscrowVault.NotCascadeParticipant.selector, CASCADE, attacker)
        );
        escrow.deposit(seller, address(poison), 50e6, 1 days, CASCADE, TOOL);

        vm.prank(arbiter);
        escrow.unwindCascade(CASCADE);
        assertEq(token.balanceOf(buyer), 100e6, "legit escrow refunded");
        assertEq(escrow.cascadeEscrowCount(CASCADE), 1, "poison never entered the tree");
    }

    /// @dev M-4/Finding2, second line of defence: membership stops outsiders, but a legitimate
    ///      participant can still pick a broken token. The unwind must skip that escrow rather
    ///      than revert, so one bad token cannot brick a whole cascade's atomic refund.
    function test_unwindCascade_skipsPoisonEscrowFromAParticipant() public {
        token.mint(buyer, 100e6);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(buyer);
        escrow.deposit(seller, address(token), 100e6, 1 days, CASCADE, TOOL);

        // The seller is a participant (they were paid inside the tree) and funds a sub-hop with
        // a token that reverts on transfer.
        PoisonToken poison = new PoisonToken();
        poison.mint(seller, 50e6);
        vm.prank(seller);
        poison.approve(address(escrow), type(uint256).max);
        vm.prank(seller);
        escrow.deposit(address(0x51), address(poison), 50e6, 1 days, CASCADE, TOOL);

        // Unwind must NOT revert despite the poison escrow.
        vm.prank(arbiter);
        escrow.unwindCascade(CASCADE);

        assertEq(token.balanceOf(buyer), 100e6, "legit escrow refunded");
        assertEq(escrow.cascadeEscrowCount(CASCADE), 2, "both tracked");
    }

    /// @dev M-5/Finding4 fix: a fee-on-transfer token books the ACTUAL received amount, so the
    ///      vault is never under-collateralized.
    function test_deposit_booksReceivedAmount_feeOnTransfer() public {
        FeeToken fee = new FeeToken();
        fee.mint(buyer, 100e6);
        vm.prank(buyer);
        fee.approve(address(escrow), type(uint256).max);
        vm.prank(buyer);
        uint256 id = escrow.deposit(seller, address(fee), 100e6, 1 days, bytes32(0), TOOL);

        (,, uint256 amount,,,) = escrow.escrowParties(id);
        assertEq(amount, 90e6, "booked the received 90, not the nominal 100");
        assertEq(fee.balanceOf(address(escrow)), 90e6, "vault holds exactly what it booked");
    }

    function test_owner_isNotImplicitArbiter() public {
        token.mint(buyer, 100e6);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(buyer);
        escrow.deposit(seller, address(token), 100e6, 1 days, CASCADE, TOOL);

        vm.prank(owner);
        vm.expectRevert(EscrowVault.NotArbiter.selector);
        escrow.unwindCascade(CASCADE);
    }

    /// @dev Guarded launch: a deposit above the per-escrow cap is rejected.
    function test_maxEscrow_capsDeposit() public {
        vm.prank(owner);
        escrow.setMaxEscrow(50e6);

        token.mint(buyer, 100e6);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);

        vm.prank(buyer);
        vm.expectRevert(EscrowVault.ExceedsCap.selector);
        escrow.deposit(seller, address(token), 100e6, 1 days, bytes32(0), TOOL);

        // At or under the cap is fine.
        vm.prank(buyer);
        escrow.deposit(seller, address(token), 50e6, 1 days, bytes32(0), TOOL);
        assertEq(escrow.escrowCount(), 1);
    }
}

contract Erc8004GatingTest is Test {
    ERC8004ReputationRegistry internal reg;
    FeedbackAllowlist internal allow;
    address internal owner = address(0xA0);
    address internal writer = address(0x9A7E);
    address internal outsider = address(0x0075);
    address internal tool = address(0x700);

    function setUp() public {
        allow = new FeedbackAllowlist(owner);
        vm.prank(owner);
        allow.setWriter(writer, true);
        reg = new ERC8004ReputationRegistry(address(allow));
        reg.registerAgent(tool);
    }

    function test_gated_rejectsUnauthorizedWriter() public {
        vm.prank(outsider);
        vm.expectRevert(ERC8004ReputationRegistry.FeedbackNotAuthorized.selector);
        reg.giveFeedback(1, 100, 0, "tiagoh", "success", "", "", bytes32(0));
    }

    function test_gated_allowsAuthorizedWriter() public {
        vm.prank(writer);
        uint64 idx = reg.giveFeedback(1, 100, 0, "tiagoh", "success", "", "", bytes32(0));
        assertEq(idx, 1);
        (uint64 count,,) = reg.getSummary(1);
        assertEq(count, 1);
    }
}

contract ToolAuctionDedupTest is Test {
    ToolAuction internal auction;
    MockERC20 internal token;
    uint256 internal constant BIDDER_PK = 0xB1;
    address internal bidder;
    address internal buyer = address(0xCAFE);
    bytes32 internal constant CAP = keccak256("cap");

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        auction = new ToolAuction(address(this), address(token));
        bidder = vm.addr(BIDDER_PK);
        // Bid bonds are exercised in ToolAuction.t.sol; this suite isolates signature dedup.
        auction.setBidBond(0);
    }

    function _bid(uint256 requestId, uint256 price) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BIDDER_PK, auction.bidHash(requestId, price));
        return abi.encodePacked(r, s, v);
    }

    /// @dev F2/Finding3 fix: replaying a bid signature cannot inflate the bids array, and a
    ///      replay of an old (higher) price cannot raise the bidder's standing bid.
    function test_replay_doesNotInflateOrRaise() public {
        vm.prank(buyer);
        uint256 id = auction.openRequest(CAP, 100e6, 1 days, ToolAuction.Policy.LOWEST_PRICE);

        bytes memory highSig = _bid(id, 80e6);
        auction.submitBid(id, 80e6, highSig);
        // The bidder lowers to 50.
        auction.submitBid(id, 50e6, _bid(id, 50e6));
        // Replay the old 80 signature many times: must be a no-op (one slot, price stays 50).
        auction.submitBid(id, 80e6, highSig);
        auction.submitBid(id, 80e6, highSig);

        assertEq(auction.bidCount(id), 1, "one slot per bidder, no inflation");
        (, uint256 price) = auction.bids(id, 0);
        assertEq(price, 50e6, "replay cannot raise the standing bid");
    }
}
