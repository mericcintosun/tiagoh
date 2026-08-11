// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC3009} from "./interfaces/IERC3009.sol";
import {IReceiptRegistry} from "./interfaces/IReceiptRegistry.sol";

/// @notice The subset of `ReceiptRegistry` this contract calls. Declared locally so the settler
///         does not import the full registry implementation.
interface IReceiptAnchor {
    struct ReceiptInput {
        bytes32 receiptId;
        bytes32 parentId;
        address payer;
        address payee;
        address token;
        uint256 amount;
        bytes32 toolId;
    }

    function anchorReceipt(
        ReceiptInput calldata r,
        bytes calldata payerSignature,
        bytes calldata payeeSignature
    ) external;
}

/// @title X402Settler
/// @notice One transaction that settles a paid x402 tool call end to end: pull the buyer's signed
///         ERC-3009 authorization, take the protocol fee, pay the seller, and anchor the receipt.
///
/// @dev    WHY THIS EXISTS. Before this contract a settlement was two transactions with nothing
///         binding them — the token transfer, and a *separate* receipt write. Three consequences,
///         all bad:
///
///         1. The receipt could be missing for a payment that happened, or written for one that
///            did not. Anchoring in the same transaction as the transfer makes the receipt a
///            by-product of the money moving rather than a claim about it.
///         2. There was nowhere to take a protocol fee without a second transfer.
///         3. The buyer needed native gas. Here the buyer only ever signs: `transferWithAuthorization`
///            is submitted by whoever relays, so a wallet holding nothing but the payment token
///            can pay.
///
///         TWO ENTRY POINTS, AND THE ASYMMETRY IS DELIBERATE.
///
///         `settle` is **permissionless**: the buyer signed the authorization (which fixes `to`
///         and `value`) *and* the receipt (which names `payee`), and the seller counter-signed
///         the same receipt. Every degree of freedom is covered by a signature, so it does not
///         matter who submits — nobody can redirect the money or alter the record.
///
///         `settleBare` is **operator-only**, and it must be. It exists for standard x402 clients,
///         which produce a payment authorization but no tiagoh receipt signatures. Without those
///         signatures nothing binds `payee`, so a permissionless version would let anyone watching
///         the mempool re-submit a pending authorization with themselves as payee and take the
///         payment. The allowlist is what replaces the missing signature.
///
///         The practical effect is that the cheapest, most convenient path is also the one that
///         produces dispute-grade evidence: if either signature is bad, `anchorReceipt` reverts
///         and the payment reverts with it.
contract X402Settler is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The payer-signed ERC-3009 authorization, exactly as it appears in the x402
    ///         `exact` scheme's `payload.authorization`.
    struct Authorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    uint256 public constant BPS = 10_000;
    /// @notice Hard ceiling on the protocol fee. Enforced in the setter, so not even the owner
    ///         can raise the fee past it — a compromised owner key cannot turn the settler into
    ///         a sink for the whole payment.
    uint256 public constant MAX_FEE_BPS = 500; // 5%

    IERC20 public immutable token;
    IReceiptAnchor public immutable registry;

    /// @notice Protocol fee in basis points. Starts at **zero**, so the deployed behaviour is
    ///         identical to taking no fee until it is switched on deliberately.
    uint256 public feeBps;
    address public treasury;
    /// @notice Guarded-launch cap on a single settlement (0 = unlimited), matching the pattern
    ///         used by `EscrowVault.maxEscrow` / `CascadeController.maxBudget` (SECURITY.md §4c).
    uint256 public maxSettlement;
    /// @dev Addresses allowed to call `settleBare` (gateways). See the asymmetry note above.
    mapping(address => bool) public isOperator;

    error NotOperator();
    error WrongRecipient();
    error AmountMismatch();
    error PayerMismatch();
    error TokenMismatch();
    error ZeroPayee();
    error ZeroAmount();
    error ExceedsCap();
    error FeeTooHigh();
    error ZeroAddress();
    error BadSignatureLength();
    error BadSignatureV();
    error NothingReceived();

    event Settled(
        bytes32 indexed receiptId,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint256 fee,
        bool cosigned
    );
    event Swept(address indexed treasury, uint256 amount);
    event FeeSet(uint256 feeBps);
    event TreasurySet(address indexed treasury);
    event MaxSettlementSet(uint256 maxSettlement);
    event OperatorSet(address indexed operator, bool allowed);

    constructor(address token_, address registry_, address treasury_, address initialOwner)
        Ownable(initialOwner)
    {
        if (token_ == address(0) || registry_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        token = IERC20(token_);
        registry = IReceiptAnchor(registry_);
        treasury = treasury_;
        // feeBps stays 0 until explicitly set.
    }

    /// @dev Least privilege, consistent with the rest of the suite: the owner is NOT implicitly
    ///      an operator. It can only (re)assign the role, which a timelock makes observable.
    modifier onlyOperator() {
        if (!isOperator[msg.sender]) revert NotOperator();
        _;
    }

    // ── configuration ────────────────────────────────────────────────────────

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = bps;
        emit FeeSet(bps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setMaxSettlement(uint256 cap) external onlyOwner {
        maxSettlement = cap;
        emit MaxSettlementSet(cap);
    }

    function setOperator(address operator, bool allowed) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        isOperator[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    // ── settlement ───────────────────────────────────────────────────────────

    /// @notice Settle a paid call and anchor the co-signed receipt, atomically.
    /// @dev    Permissionless — see the contract-level note. If either receipt signature fails to
    ///         verify, `anchorReceipt` reverts and the token transfer reverts with it, so a
    ///         settled payment always leaves behind evidence a buyer can dispute against.
    /// @param auth      The payer-signed ERC-3009 authorization (`to` must be this contract).
    /// @param signature 65-byte secp256k1 signature over the authorization.
    /// @param r         The receipt both parties signed.
    function settle(
        Authorization calldata auth,
        bytes calldata signature,
        IReceiptAnchor.ReceiptInput calldata r,
        bytes calldata payerSignature,
        bytes calldata payeeSignature
    ) external nonReentrant {
        uint256 received = _pullAndSplit(auth, signature, r.payer, r.payee, r.amount, r.token);
        // Anchor last: the receipt is a consequence of the money having moved, and a bad
        // signature unwinds the whole transaction.
        registry.anchorReceipt(r, payerSignature, payeeSignature);
        emit Settled(
            r.receiptId, auth.from, r.payee, received, received - _netOf(received), true
        );
    }

    /// @notice Settle a payment from a standard x402 client that produced no receipt signatures.
    /// @dev    Operator-only. The receipt is written at `RECORDER` level, which harm-binding
    ///         rejects — but unlike a gateway's unilateral telemetry it is written in the same
    ///         transaction as a real token transfer, so it cannot describe a payment that did
    ///         not happen.
    function settleBare(
        Authorization calldata auth,
        bytes calldata signature,
        bytes32 receiptId,
        bytes32 parentId,
        bytes32 toolId,
        address payee
    ) external onlyOperator nonReentrant {
        uint256 received =
            _pullAndSplit(auth, signature, auth.from, payee, auth.value, address(token));
        IReceiptRegistry(address(registry)).recordReceipt(
            receiptId, parentId, auth.from, payee, address(token), received, toolId
        );
        emit Settled(receiptId, auth.from, payee, received, received - _netOf(received), false);
    }

    /// @dev Pull the authorized amount into this contract, then pay out the fee and the net.
    ///      Amounts are booked from the **actual balance delta**, so a fee-on-transfer or
    ///      rebasing token can never make the settler promise more than it holds.
    function _pullAndSplit(
        Authorization calldata auth,
        bytes calldata signature,
        address expectedPayer,
        address payee,
        uint256 expectedAmount,
        address expectedToken
    ) private returns (uint256 received) {
        // The authorization must pay *this* contract, or the split below would hand out tokens
        // the settler never received.
        if (auth.to != address(this)) revert WrongRecipient();
        if (auth.from != expectedPayer) revert PayerMismatch();
        if (auth.value != expectedAmount) revert AmountMismatch();
        if (expectedToken != address(token)) revert TokenMismatch();
        if (payee == address(0)) revert ZeroPayee();
        if (auth.value == 0) revert ZeroAmount();
        if (maxSettlement != 0 && auth.value > maxSettlement) revert ExceedsCap();

        (uint8 v, bytes32 sr, bytes32 ss) = _splitSignature(signature);

        // Slither flags the balance read either side of an external call as `reentrancy-balance`.
        // It is not reachable here: both entry points are `nonReentrant`, this function is
        // `private`, and every other state-changing function is `onlyOwner`. `token` is immutable
        // and chosen at deploy, so the only contract that could re-enter is one the deployment
        // already trusts with every payment it will ever handle.
        // slither-disable-next-line reentrancy-balance,reentrancy-events,reentrancy-no-eth
        uint256 balBefore = token.balanceOf(address(this));
        // Reverts on a bad signature, an expired/not-yet-valid window, or a spent nonce — the
        // token itself is the replay guard, which is stronger than any gateway-side nonce set.
        IERC3009(address(token)).transferWithAuthorization(
            auth.from, address(this), auth.value, auth.validAfter, auth.validBefore, auth.nonce, v, sr, ss
        );
        // The delta, not the whole balance: a stray donation must not be counted as part of this
        // payment, or it would be reported as volume nobody paid and split as though it were.
        // Donations are recoverable through `sweep`.
        received = token.balanceOf(address(this)) - balBefore;
        if (received == 0) revert NothingReceived();

        uint256 net = _netOf(received);
        uint256 fee = received - net;
        if (fee > 0) token.safeTransfer(treasury, fee);
        token.safeTransfer(payee, net);
    }

    /// @dev The seller's share. Integer division rounds the *fee* down, so the payee is never
    ///      short-changed by rounding and `fee + net == received` holds exactly.
    function _netOf(uint256 amount) private view returns (uint256) {
        return amount - ((amount * feeBps) / BPS);
    }

    /// @dev Split a 65-byte signature and normalize `v`. Wallets differ on whether they emit
    ///      27/28 or 0/1; the token only accepts the former, so a signature that is perfectly
    ///      valid would otherwise be rejected depending on which wallet produced it.
    function _splitSignature(bytes calldata signature)
        private
        pure
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        if (signature.length != 65) revert BadSignatureLength();
        r = bytes32(signature[0:32]);
        s = bytes32(signature[32:64]);
        v = uint8(signature[64]);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert BadSignatureV();
    }

    /// @notice The fee and net a given gross amount would split into, at the current `feeBps`.
    ///         Exposed so a client can show the buyer what the seller actually receives.
    function quote(uint256 amount) external view returns (uint256 fee, uint256 net) {
        net = _netOf(amount);
        fee = amount - net;
    }

    /// @notice Push any balance this contract is holding to the treasury.
    ///
    /// @dev    Settlement books the **delta** across the transfer, so a token sent here by any
    ///         other route — a mistaken transfer, a dusting, an airdrop — is never picked up by a
    ///         settlement and would otherwise sit here forever: this contract is a conduit and has
    ///         no other way to move a balance out.
    ///
    ///         Permissionless on purpose. The destination is fixed to `treasury`, so letting
    ///         anyone trigger it adds no privilege over funds that `setTreasury` does not already
    ///         imply, and it means recovery does not depend on the owner key being available.
    ///         Under normal operation the balance is zero and this is a no-op.
    function sweep() external nonReentrant returns (uint256 amount) {
        amount = token.balanceOf(address(this));
        if (amount > 0) {
            token.safeTransfer(treasury, amount);
            emit Swept(treasury, amount);
        }
    }
}
