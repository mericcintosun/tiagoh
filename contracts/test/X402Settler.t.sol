// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {X402Settler, IReceiptAnchor} from "../src/X402Settler.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";
import {MockERC3009} from "./mocks/MockERC3009.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Shared fixture: a FiatTokenV2-shaped token, the real ReceiptRegistry, and a settler wired
///      to both. Buyer and seller are real keys, so every signature here is a genuine secp256k1
///      signature over exactly the EIP-712 digests the production path produces.
///
///      NOTE ON TEST STYLE: signatures are always built into locals *before* `vm.prank` /
///      `vm.expectRevert`. The signing helpers make external calls (`DOMAIN_SEPARATOR`,
///      `receiptHash`), and a prank or an expectRevert would be consumed by those instead of the
///      call under test — silently turning an assertion into a no-op.
contract X402SettlerBase is Test {
    X402Settler internal settler;
    ReceiptRegistry internal registry;
    MockERC3009 internal token;

    uint256 internal buyerKey = 0xB0B;
    uint256 internal sellerKey = 0x5E11E4;
    address internal buyer;
    address internal seller;

    address internal owner = address(0xA0);
    address internal treasury = address(0x774E);
    address internal operator = address(0x0BE4);
    address internal relayer = address(0xBEEF);

    /// @dev Mirrored locally so tests never make an external call at a moment when a prank or an
    ///      expectRevert is armed. `test_constants_matchTheContract` keeps them honest.
    uint256 internal constant MAX_FEE_BPS = 500;
    uint256 internal constant BPS = 10_000;

    bytes32 internal constant TOOL = keccak256("get_goat_chain_stats");
    bytes32 internal constant AUTH_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function setUp() public virtual {
        buyer = vm.addr(buyerKey);
        seller = vm.addr(sellerKey);

        token = new MockERC3009("Bridged USDC (Stargate)", "USDC.e", 6);
        registry = new ReceiptRegistry(owner);
        settler = new X402Settler(address(token), address(registry), treasury, owner);

        vm.startPrank(owner);
        // settleBare writes a RECORDER-level receipt, so the settler needs the recorder role.
        registry.setRecorder(address(settler), true);
        settler.setOperator(operator, true);
        vm.stopPrank();

        token.mint(buyer, 1_000e6);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _auth(uint256 value, bytes32 nonce)
        internal
        view
        returns (X402Settler.Authorization memory)
    {
        return X402Settler.Authorization({
            from: buyer,
            to: address(settler),
            value: value,
            validAfter: 0,
            validBefore: block.timestamp + 300,
            nonce: nonce
        });
    }

    function _signAuth(X402Settler.Authorization memory a, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(AUTH_TYPEHASH, a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce)
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _receipt(bytes32 receiptId, bytes32 parentId, uint256 amount)
        internal
        view
        returns (IReceiptAnchor.ReceiptInput memory)
    {
        return IReceiptAnchor.ReceiptInput({
            receiptId: receiptId,
            parentId: parentId,
            payer: buyer,
            payee: seller,
            token: address(token),
            amount: amount,
            toolId: TOOL
        });
    }

    function _signReceipt(IReceiptAnchor.ReceiptInput memory r, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        ReceiptRegistry.ReceiptInput memory rr = ReceiptRegistry.ReceiptInput({
            receiptId: r.receiptId,
            parentId: r.parentId,
            payer: r.payer,
            payee: r.payee,
            token: r.token,
            amount: r.amount,
            toolId: r.toolId
        });
        (uint8 v, bytes32 sr, bytes32 ss) = vm.sign(key, registry.receiptHash(rr));
        return abi.encodePacked(sr, ss, v);
    }

    /// @dev One full settlement, as the gateway would build it.
    function _settle(uint256 amount, bytes32 nonce, bytes32 receiptId, bytes32 parentId) internal {
        X402Settler.Authorization memory a = _auth(amount, nonce);
        IReceiptAnchor.ReceiptInput memory r = _receipt(receiptId, parentId, amount);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);
        vm.prank(relayer);
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    function _setFee(uint256 bps) internal {
        vm.prank(owner);
        settler.setFeeBps(bps);
    }
}

contract X402SettlerTest is X402SettlerBase {
    function test_constants_matchTheContract() public view {
        assertEq(settler.MAX_FEE_BPS(), MAX_FEE_BPS, "local mirror of MAX_FEE_BPS drifted");
        assertEq(settler.BPS(), BPS, "local mirror of BPS drifted");
    }

    // ── the happy path ───────────────────────────────────────────────────────

    function test_settle_paysSellerAndAnchorsCosignedReceipt() public {
        _settle(20_000, keccak256("n1"), keccak256("r1"), bytes32(0));

        assertEq(token.balanceOf(seller), 20_000, "seller paid in full at feeBps=0");
        assertEq(token.balanceOf(buyer), 1_000e6 - 20_000, "buyer debited exactly the price");
        assertEq(token.balanceOf(address(settler)), 0, "settler keeps nothing");
        assertTrue(registry.isCosigned(keccak256("r1")), "receipt is dispute-grade");
        assertEq(registry.count(), 1, "one receipt");
    }

    function test_settle_isPermissionless() public {
        // Anyone may relay: every degree of freedom is covered by a signature.
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.prank(address(0xD00D));
        settler.settle(a, authSig, r, payerSig, payeeSig);
        assertEq(token.balanceOf(seller), 10_000, "relayed by a stranger, still correct");
    }

    function test_settle_buyerNeedsNoNativeBalance() public {
        // The whole point: the payer signs, someone else pays gas.
        vm.deal(buyer, 0);
        _settle(10_000, keccak256("n"), keccak256("r"), bytes32(0));
        assertEq(buyer.balance, 0, "buyer never spent gas");
        assertEq(token.balanceOf(seller), 10_000, "and still paid");
    }

    function test_settle_cascadeHopCarriesParent() public {
        _settle(100_000, keccak256("root-n"), keccak256("root"), bytes32(0));
        _settle(20_000, keccak256("hop-n"), keccak256("hop"), keccak256("root"));

        assertEq(registry.childCount(keccak256("root")), 1, "hop linked to its parent");
        assertTrue(registry.isCosigned(keccak256("hop")), "hops are co-signable too");
    }

    // ── the fee ──────────────────────────────────────────────────────────────

    function test_fee_defaultsToZero() public view {
        assertEq(settler.feeBps(), 0, "no fee until switched on");
        (uint256 fee, uint256 net) = settler.quote(1_000_000);
        assertEq(fee, 0);
        assertEq(net, 1_000_000);
    }

    function test_fee_splitsToTreasury() public {
        _setFee(200); // 2%
        _settle(100_000, keccak256("n"), keccak256("r"), bytes32(0));

        assertEq(token.balanceOf(treasury), 2_000, "treasury took 2%");
        assertEq(token.balanceOf(seller), 98_000, "seller took the rest");
        assertEq(token.balanceOf(address(settler)), 0, "nothing stranded");
    }

    function test_fee_cannotExceedCap() public {
        vm.prank(owner);
        vm.expectRevert(X402Settler.FeeTooHigh.selector);
        settler.setFeeBps(MAX_FEE_BPS + 1);

        _setFee(MAX_FEE_BPS); // the cap itself is allowed
        assertEq(settler.feeBps(), MAX_FEE_BPS);
    }

    function test_fee_onlyOwnerMayChange() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        settler.setFeeBps(100);
    }

    function test_fee_receiptRecordsGrossNotNet() public {
        // The buyer signed a receipt for the gross price; the fee is the protocol's business,
        // not a discount on what the buyer paid.
        _setFee(200);
        _settle(100_000, keccak256("n"), keccak256("r"), bytes32(0));
        assertEq(registry.getReceipt(keccak256("r")).amount, 100_000, "receipt holds the gross");
    }

    // ── binding: nothing about the payment is free-floating ──────────────────

    function test_settle_rejectsAuthorizationPayingSomeoneElse() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        a.to = address(0xDEAD); // would let the split hand out tokens never received
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.WrongRecipient.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    function test_settle_rejectsAmountMismatch() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 99_999);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.AmountMismatch.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    function test_settle_rejectsPayerMismatch() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        r.payer = address(0xC0FFEE);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.PayerMismatch.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    function test_settle_rejectsForeignToken() public {
        MockERC20 other = new MockERC20("Other", "OTH", 6);
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        r.token = address(other);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.TokenMismatch.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    function test_settle_rejectsZeroPayee() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        r.payee = address(0);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.ZeroPayee.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    function test_settle_rejectsZeroAmount() public {
        X402Settler.Authorization memory a = _auth(0, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 0);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.ZeroAmount.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    // ── signatures ───────────────────────────────────────────────────────────

    function test_settle_rejectsForgedPaymentAuthorization() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory forged = _signAuth(a, sellerKey); // seller signing the buyer's authorization
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(MockERC3009.InvalidSignature.selector);
        settler.settle(a, forged, r, payerSig, payeeSig);
    }

    function test_settle_revertsEntirelyWhenReceiptSignatureIsBad() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory notThePayee = _signReceipt(r, buyerKey); // buyer signing as the payee

        vm.expectRevert(ReceiptRegistry.BadPayeeSignature.selector);
        settler.settle(a, authSig, r, payerSig, notThePayee);

        // Atomicity is the whole point: no evidence means no payment either.
        assertEq(token.balanceOf(seller), 0, "payment reverted with the anchor");
        assertEq(token.balanceOf(buyer), 1_000e6, "buyer untouched");
    }

    function test_settle_acceptsLegacyVEncoding() public {
        // Some wallets emit v as 0/1 rather than 27/28. A valid signature must not be rejected
        // because of which library produced it.
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory sig = _signAuth(a, buyerKey);
        sig[64] = bytes1(uint8(sig[64]) - 27); // 27/28 → 0/1
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        settler.settle(a, sig, r, payerSig, payeeSig);
        assertEq(token.balanceOf(seller), 10_000, "legacy v accepted");
    }

    function test_settle_rejectsUnrecoverableV() public {
        // Normalization turns 0/1 into 27/28; anything else is not a signature this curve can
        // recover from, and must be rejected rather than passed to the token.
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory sig = _signAuth(a, buyerKey);
        sig[64] = bytes1(uint8(30));
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.BadSignatureV.selector);
        settler.settle(a, sig, r, payerSig, payeeSig);
    }

    function test_settleBare_rejectsAuthorizationPayingSomeoneElse() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        a.to = address(0xDEAD);
        bytes memory authSig = _signAuth(a, buyerKey);

        vm.prank(operator);
        vm.expectRevert(X402Settler.WrongRecipient.selector);
        settler.settleBare(a, authSig, keccak256("r"), bytes32(0), TOOL, seller);
    }

    function test_settle_rejectsMalformedSignature() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.BadSignatureLength.selector);
        settler.settle(a, hex"1234", r, payerSig, payeeSig);
    }

    // ── replay: the token is the guard ───────────────────────────────────────

    function test_settle_authorizationIsSingleUse() public {
        _settle(10_000, keccak256("n"), keccak256("r1"), bytes32(0));

        // Same nonce, fresh receipt id — the token itself refuses.
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r2"), bytes32(0), 10_000);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(MockERC3009.AuthorizationAlreadyUsed.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);
        assertEq(token.balanceOf(seller), 10_000, "charged exactly once");
    }

    function test_settle_receiptIsSingleUse() public {
        _settle(10_000, keccak256("n1"), keccak256("r"), bytes32(0));

        X402Settler.Authorization memory a = _auth(10_000, keccak256("n2"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(
            abi.encodeWithSelector(ReceiptRegistry.DuplicateReceipt.selector, keccak256("r"))
        );
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    function test_settle_rejectsExpiredAuthorization() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 10_000);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.warp(a.validBefore + 1);
        vm.expectRevert(MockERC3009.AuthorizationExpired.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);
    }

    // ── guarded launch ───────────────────────────────────────────────────────

    function test_maxSettlement_capsASinglePayment() public {
        vm.prank(owner);
        settler.setMaxSettlement(50_000);

        X402Settler.Authorization memory a = _auth(50_001, keccak256("n"));
        IReceiptAnchor.ReceiptInput memory r = _receipt(keccak256("r"), bytes32(0), 50_001);
        bytes memory authSig = _signAuth(a, buyerKey);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        vm.expectRevert(X402Settler.ExceedsCap.selector);
        settler.settle(a, authSig, r, payerSig, payeeSig);

        _settle(50_000, keccak256("n2"), keccak256("r2"), bytes32(0)); // at the cap: fine
        assertEq(token.balanceOf(seller), 50_000);
    }

    // ── settleBare (standard x402 clients) ───────────────────────────────────

    function test_settleBare_paysAndRecords() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        bytes memory authSig = _signAuth(a, buyerKey);

        vm.prank(operator);
        settler.settleBare(a, authSig, keccak256("r"), bytes32(0), TOOL, seller);

        assertEq(token.balanceOf(seller), 10_000, "seller paid");
        assertTrue(registry.exists(keccak256("r")), "receipt written");
        assertFalse(registry.isCosigned(keccak256("r")), "but telemetry-grade, not evidence");
    }

    function test_settleBare_isOperatorOnly() public {
        // Without receipt signatures nothing binds `payee`, so a permissionless version would let
        // a mempool watcher re-point a pending authorization at themselves.
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        bytes memory authSig = _signAuth(a, buyerKey);

        vm.prank(address(0xBAD));
        vm.expectRevert(X402Settler.NotOperator.selector);
        settler.settleBare(a, authSig, keccak256("r"), bytes32(0), TOOL, address(0xBAD));
    }

    function test_settleBare_ownerIsNotImplicitlyAnOperator() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        bytes memory authSig = _signAuth(a, buyerKey);

        vm.prank(owner);
        vm.expectRevert(X402Settler.NotOperator.selector);
        settler.settleBare(a, authSig, keccak256("r"), bytes32(0), TOOL, seller);
    }

    function test_settleBare_takesTheSameFee() public {
        _setFee(200);
        X402Settler.Authorization memory a = _auth(100_000, keccak256("n"));
        bytes memory authSig = _signAuth(a, buyerKey);

        vm.prank(operator);
        settler.settleBare(a, authSig, keccak256("r"), bytes32(0), TOOL, seller);

        assertEq(token.balanceOf(treasury), 2_000);
        assertEq(token.balanceOf(seller), 98_000);
    }

    function test_settleBare_rejectsZeroPayee() public {
        X402Settler.Authorization memory a = _auth(10_000, keccak256("n"));
        bytes memory authSig = _signAuth(a, buyerKey);

        vm.prank(operator);
        vm.expectRevert(X402Settler.ZeroPayee.selector);
        settler.settleBare(a, authSig, keccak256("r"), bytes32(0), TOOL, address(0));
    }

    // ── stray balances ───────────────────────────────────────────────────────

    function test_donation_doesNotInflateASettlement() public {
        // Settlement books the delta across the transfer. If it took the whole balance instead,
        // a donation would be split as though the buyer had paid it and reported as volume
        // nobody paid.
        token.mint(address(settler), 500_000);

        _settle(10_000, keccak256("n"), keccak256("r"), bytes32(0));

        assertEq(token.balanceOf(seller), 10_000, "seller got the price, not the donation");
        assertEq(registry.getReceipt(keccak256("r")).amount, 10_000, "volume is the price");
        assertEq(token.balanceOf(address(settler)), 500_000, "donation still sitting here");
    }

    function test_sweep_recoversStrandedTokens() public {
        // Without this the donation above would be lost forever: the contract is a conduit and
        // has no other path for a balance it did not receive during a settlement.
        token.mint(address(settler), 500_000);

        vm.prank(address(0xD00D)); // permissionless: recovery must not need the owner key
        settler.sweep();

        assertEq(token.balanceOf(treasury), 500_000, "stranded tokens recovered to treasury");
        assertEq(token.balanceOf(address(settler)), 0, "nothing left behind");
    }

    function test_sweep_isANoOpWhenEmpty() public {
        settler.sweep();
        assertEq(token.balanceOf(treasury), 0);
    }

    function test_sweep_followsTheTreasury() public {
        address newTreasury = address(0x7EA2);
        vm.prank(owner);
        settler.setTreasury(newTreasury);
        token.mint(address(settler), 1_000);

        settler.sweep();
        assertEq(token.balanceOf(newTreasury), 1_000, "sweep cannot be redirected off-treasury");
    }

    // ── configuration hygiene ────────────────────────────────────────────────

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(X402Settler.ZeroAddress.selector);
        new X402Settler(address(0), address(registry), treasury, owner);
        vm.expectRevert(X402Settler.ZeroAddress.selector);
        new X402Settler(address(token), address(0), treasury, owner);
        vm.expectRevert(X402Settler.ZeroAddress.selector);
        new X402Settler(address(token), address(registry), address(0), owner);
    }

    function test_setTreasury_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(X402Settler.ZeroAddress.selector);
        settler.setTreasury(address(0));
    }

    function test_setTreasury_redirectsTheFee() public {
        address newTreasury = address(0x7EA2);
        vm.prank(owner);
        settler.setTreasury(newTreasury);
        _setFee(500);

        _settle(100_000, keccak256("n"), keccak256("r"), bytes32(0));
        assertEq(token.balanceOf(newTreasury), 5_000, "fee follows the treasury");
        assertEq(token.balanceOf(treasury), 0, "old treasury gets nothing");
    }

    function test_setOperator_isOwnerOnly() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        settler.setOperator(address(0xBAD), true);
    }

    function test_setOperator_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(X402Settler.ZeroAddress.selector);
        settler.setOperator(address(0), true);
    }
}

// ── fuzz ─────────────────────────────────────────────────────────────────────

contract X402SettlerFuzzTest is X402SettlerBase {
    /// @dev The split must be exact at every fee and every amount: the protocol and the seller
    ///      together receive precisely what the buyer paid, with nothing stranded or conjured.
    function testFuzz_splitIsExact(uint256 amount, uint256 bps) public {
        amount = bound(amount, 1, 1_000e6);
        bps = bound(bps, 0, MAX_FEE_BPS);
        _setFee(bps);

        _settle(amount, keccak256("n"), keccak256("r"), bytes32(0));

        uint256 fee = token.balanceOf(treasury);
        uint256 net = token.balanceOf(seller);
        assertEq(fee + net, amount, "fee + net == gross, exactly");
        assertEq(token.balanceOf(address(settler)), 0, "settler holds nothing");
        assertLe(fee, (amount * bps) / BPS, "fee never rounds up against the seller");
    }

    /// @dev A buyer is never debited more than they authorized, whatever the fee is set to.
    function testFuzz_buyerPaysExactlyTheAuthorizedAmount(uint256 amount, uint256 bps) public {
        amount = bound(amount, 1, 1_000e6);
        bps = bound(bps, 0, MAX_FEE_BPS);
        _setFee(bps);

        uint256 before = token.balanceOf(buyer);
        _settle(amount, keccak256("n"), keccak256("r"), bytes32(0));
        assertEq(before - token.balanceOf(buyer), amount, "debited exactly the signed value");
    }

    /// @dev The fee ceiling holds for any input the owner can supply.
    function testFuzz_feeCeilingIsAbsolute(uint256 bps) public {
        if (bps > MAX_FEE_BPS) {
            vm.prank(owner);
            vm.expectRevert(X402Settler.FeeTooHigh.selector);
            settler.setFeeBps(bps);
            assertEq(settler.feeBps(), 0, "rejected, unchanged");
        } else {
            _setFee(bps);
            assertLe(settler.feeBps(), MAX_FEE_BPS);
        }
    }

    /// @dev `quote` is the same arithmetic the settlement performs — a client that shows the
    ///      buyer a quote must not be shown a different number than the chain applies.
    function testFuzz_quoteMatchesSettlement(uint256 amount, uint256 bps) public {
        amount = bound(amount, 1, 1_000e6);
        bps = bound(bps, 0, MAX_FEE_BPS);
        _setFee(bps);

        (uint256 quotedFee, uint256 quotedNet) = settler.quote(amount);
        _settle(amount, keccak256("n"), keccak256("r"), bytes32(0));

        assertEq(token.balanceOf(treasury), quotedFee, "quoted fee == charged fee");
        assertEq(token.balanceOf(seller), quotedNet, "quoted net == paid net");
    }
}

// ── invariant ────────────────────────────────────────────────────────────────

/// @dev Drives real settlements with varying amounts and fees. Every external call is made
///      without a prank armed except the one it is meant for.
contract SettlerHandler is Test {
    X402Settler internal settler;
    ReceiptRegistry internal registry;
    MockERC3009 internal token;
    uint256 internal buyerKey;
    uint256 internal sellerKey;
    address internal buyer;
    address internal seller;
    address internal owner;

    uint256 public seq;
    uint256 public settled;

    bytes32 internal constant AUTH_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    constructor(
        X402Settler s,
        ReceiptRegistry reg,
        MockERC3009 t,
        uint256 bKey,
        uint256 sKey,
        address o
    ) {
        settler = s;
        registry = reg;
        token = t;
        buyerKey = bKey;
        sellerKey = sKey;
        buyer = vm.addr(bKey);
        seller = vm.addr(sKey);
        owner = o;
    }

    function settleOne(uint256 amount, uint16 bps) external {
        amount = bound(amount, 1, 1e6);
        uint256 fee = bound(bps, 0, settler.MAX_FEE_BPS());
        if (token.balanceOf(buyer) < amount) return;

        vm.prank(owner);
        settler.setFeeBps(fee);

        seq++;
        X402Settler.Authorization memory a = X402Settler.Authorization({
            from: buyer,
            to: address(settler),
            value: amount,
            validAfter: 0,
            validBefore: block.timestamp + 3600,
            nonce: keccak256(abi.encode("inv-nonce", seq))
        });
        IReceiptAnchor.ReceiptInput memory r = IReceiptAnchor.ReceiptInput({
            receiptId: keccak256(abi.encode("inv-receipt", seq)),
            parentId: bytes32(0),
            payer: buyer,
            payee: seller,
            token: address(token),
            amount: amount,
            toolId: keccak256("tool")
        });

        bytes memory authSig = _signAuth(a);
        bytes memory payerSig = _signReceipt(r, buyerKey);
        bytes memory payeeSig = _signReceipt(r, sellerKey);

        settler.settle(a, authSig, r, payerSig, payeeSig);
        settled++;
    }

    function _signAuth(X402Settler.Authorization memory a) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(AUTH_TYPEHASH, a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            buyerKey, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash))
        );
        return abi.encodePacked(r, s, v);
    }

    function _signReceipt(IReceiptAnchor.ReceiptInput memory r, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        ReceiptRegistry.ReceiptInput memory rr = ReceiptRegistry.ReceiptInput({
            receiptId: r.receiptId,
            parentId: r.parentId,
            payer: r.payer,
            payee: r.payee,
            token: r.token,
            amount: r.amount,
            toolId: r.toolId
        });
        (uint8 v, bytes32 sr, bytes32 ss) = vm.sign(key, registry.receiptHash(rr));
        return abi.encodePacked(sr, ss, v);
    }
}

contract X402SettlerInvariantTest is Test {
    X402Settler internal settler;
    ReceiptRegistry internal registry;
    MockERC3009 internal token;
    SettlerHandler internal handler;

    uint256 internal buyerKey = 0xB0B;
    uint256 internal sellerKey = 0x5E11E4;
    address internal owner = address(0xA0);
    address internal treasury = address(0x774E);
    uint256 internal constant FUNDED = 1_000_000e6;

    function setUp() public {
        token = new MockERC3009("Bridged USDC (Stargate)", "USDC.e", 6);
        registry = new ReceiptRegistry(owner);
        settler = new X402Settler(address(token), address(registry), treasury, owner);
        handler = new SettlerHandler(settler, registry, token, buyerKey, sellerKey, owner);

        vm.prank(owner);
        registry.setRecorder(address(settler), true);

        token.mint(vm.addr(buyerKey), FUNDED);
        targetContract(address(handler));
    }

    /// @dev Guards against the run passing vacuously. If every handler call reverted, the
    ///      invariants below would hold trivially and prove nothing — a green suite that tested
    ///      nothing is worse than a red one. Checked in `afterInvariant` rather than as an
    ///      invariant because Foundry also evaluates invariants before the first call, when no
    ///      settlement can have happened yet.
    function afterInvariant() public view {
        assertGt(handler.settled(), 0, "no settlement executed: invariants would be vacuous");
    }

    /// @dev The settler is a conduit, never a vault. If it could retain balance, a rounding bug
    ///      or a mis-ordered transfer would quietly accumulate value nobody can withdraw — there
    ///      is no sweep function, so anything stuck here is lost forever.
    function invariant_settlerNeverRetainsTokens() public view {
        assertEq(token.balanceOf(address(settler)), 0, "settler holds no residue");
    }

    /// @dev Everything the buyer spent arrived somewhere legitimate.
    function invariant_valueIsConserved() public view {
        uint256 spent = FUNDED - token.balanceOf(vm.addr(buyerKey));
        assertEq(
            spent,
            token.balanceOf(vm.addr(sellerKey)) + token.balanceOf(treasury),
            "every unit debited reached the seller or the treasury"
        );
    }

    /// @dev The registry's volume matches what actually moved — no phantom receipts.
    function invariant_recordedVolumeMatchesTransfers() public view {
        uint256 spent = FUNDED - token.balanceOf(vm.addr(buyerKey));
        assertEq(registry.totalVolume(), spent, "anchored volume == transferred volume");
    }
}
