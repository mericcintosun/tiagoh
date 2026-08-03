// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IReceiptRegistry, IReceiptEvidence} from "./interfaces/IReceiptRegistry.sol";

/// @title ReceiptRegistry
/// @notice Anchors every settled x402 tool call on-chain with its cascade `parentId`,
///         so the full payment graph reconstructs from chain data alone (PRD §5.0 C5).
///
/// @dev    Two attestation levels, deliberately distinguished:
///
///         - `RECORDER` — written by an authorized gateway. This is **telemetry**: a single
///           party (the seller's own infrastructure) asserts a call happened. It is useful for
///           the explorer, but it is NOT evidence — a seller could fabricate it.
///         - `COSIGNED` — anchored permissionlessly by anyone who holds an EIP-712 signature
///           over the receipt from BOTH the payer and the payee. Neither side can forge it
///           alone, so it IS evidence: `DisputeArbiter` binds harm to co-signed receipts only.
///
///         Signature verification goes through OZ `SignatureChecker`, so an ERC-1271 smart
///         account (ERC-4337 agent wallets, multisigs) can be a payer or payee just as an EOA
///         can. The EIP-712 domain binds chainId + this contract, so a receipt signature can
///         never replay on another chain or another deployment.
contract ReceiptRegistry is Ownable2Step, EIP712, IReceiptRegistry, IReceiptEvidence {
    /// @notice How a receipt's truth is backed. Consumers MUST require `COSIGNED` for anything
    ///         that moves value; `RECORDER` is unilateral and therefore only informational.
    enum Attestation {
        NONE,
        RECORDER,
        COSIGNED
    }

    struct Receipt {
        bytes32 parentId;
        address payer;
        address payee;
        address token;
        uint256 amount;
        bytes32 toolId;
        uint64 timestamp;
        Attestation attestation;
    }

    /// @notice The tuple both parties sign. `receiptId` is chosen by the gateway and is
    ///         deterministic in the payment authorization, which makes anchoring idempotent.
    struct ReceiptInput {
        bytes32 receiptId;
        bytes32 parentId;
        address payer;
        address payee;
        address token;
        uint256 amount;
        bytes32 toolId;
    }

    bytes32 public constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(bytes32 receiptId,bytes32 parentId,address payer,address payee,address token,uint256 amount,bytes32 toolId)"
    );

    /// @dev receiptId => Receipt
    mapping(bytes32 => Receipt) private _receipts;
    /// @dev authorized gateway recorders (telemetry-only writes)
    mapping(address => bool) public isRecorder;
    /// @dev parentId => number of direct child receipts (cascade fan-out)
    mapping(bytes32 => uint256) public childCount;

    uint256 public count;
    uint256 public totalVolume;
    /// @notice Count of receipts backed by both parties' signatures (the evidence subset).
    uint256 public cosignedCount;

    error NotRecorder();
    error DuplicateReceipt(bytes32 receiptId);
    error ZeroReceiptId();
    error ZeroParty();
    error BadPayerSignature();
    error BadPayeeSignature();

    event RecorderSet(address indexed recorder, bool allowed);
    /// @notice Emitted alongside `ReceiptRecorded` so indexers can filter on attestation level.
    event ReceiptAttested(bytes32 indexed receiptId, Attestation attestation);

    constructor(address initialOwner) Ownable(initialOwner) EIP712("tiagoh ReceiptRegistry", "1") {}

    /// @dev Least privilege: the owner is NOT implicitly a recorder. Receipts are the input to
    ///      reputation and (when co-signed) to dispute harm-binding, so the owner key must not
    ///      be able to mint them; it can only (re)assign recorders, which a timelock makes
    ///      observable.
    modifier onlyRecorder() {
        if (!isRecorder[msg.sender]) revert NotRecorder();
        _;
    }

    /// @notice Grant/revoke a gateway recorder.
    function setRecorder(address recorder, bool allowed) external onlyOwner {
        isRecorder[recorder] = allowed;
        emit RecorderSet(recorder, allowed);
    }

    /// @inheritdoc IReceiptRegistry
    /// @dev Unilateral telemetry write. Stored as `RECORDER`, which harm-binding rejects.
    function recordReceipt(
        bytes32 receiptId,
        bytes32 parentId,
        address payer,
        address payee,
        address token,
        uint256 amount,
        bytes32 toolId
    ) external onlyRecorder {
        _store(
            ReceiptInput({
                receiptId: receiptId,
                parentId: parentId,
                payer: payer,
                payee: payee,
                token: token,
                amount: amount,
                toolId: toolId
            }),
            Attestation.RECORDER
        );
    }

    /// @notice The EIP-712 digest both the payer and the payee sign over a receipt.
    function receiptHash(ReceiptInput calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECEIPT_TYPEHASH,
                    r.receiptId,
                    r.parentId,
                    r.payer,
                    r.payee,
                    r.token,
                    r.amount,
                    r.toolId
                )
            )
        );
    }

    /// @notice Anchor a receipt backed by BOTH parties' signatures. Permissionless: since the
    ///         receipt is only valid with both signatures, anyone may submit it (a relayer, the
    ///         buyer, the seller), and neither party can forge or suppress it unilaterally.
    ///         This is the write that produces dispute-grade evidence.
    function anchorReceipt(
        ReceiptInput calldata r,
        bytes calldata payerSignature,
        bytes calldata payeeSignature
    ) external {
        if (r.payer == address(0) || r.payee == address(0)) {
            revert ZeroParty();
        }

        bytes32 digest = receiptHash(r);
        // ERC-1271 aware: an ERC-4337 agent account or a multisig can sign just like an EOA.
        if (!SignatureChecker.isValidSignatureNow(r.payer, digest, payerSignature)) {
            revert BadPayerSignature();
        }
        if (!SignatureChecker.isValidSignatureNow(r.payee, digest, payeeSignature)) {
            revert BadPayeeSignature();
        }

        _store(r, Attestation.COSIGNED);
    }

    function _store(ReceiptInput memory r, Attestation attestation) internal {
        if (r.receiptId == bytes32(0)) revert ZeroReceiptId();
        if (_receipts[r.receiptId].attestation != Attestation.NONE) {
            revert DuplicateReceipt(r.receiptId);
        }

        _receipts[r.receiptId] = Receipt({
            parentId: r.parentId,
            payer: r.payer,
            payee: r.payee,
            token: r.token,
            amount: r.amount,
            toolId: r.toolId,
            timestamp: uint64(block.timestamp),
            attestation: attestation
        });

        // Not `unchecked`: with permissionless co-signed anchoring the amount is attacker-
        // influenced (two colluding parties can sign any value), so a wrapping counter would
        // be a cheap way to corrupt the public volume stat.
        count += 1;
        totalVolume += r.amount;
        if (attestation == Attestation.COSIGNED) {
            cosignedCount += 1;
        }
        if (r.parentId != bytes32(0)) {
            childCount[r.parentId] += 1;
        }

        emit ReceiptRecorded(r.receiptId, r.parentId, r.payee, r.payer, r.token, r.amount, r.toolId);
        emit ReceiptAttested(r.receiptId, attestation);
    }

    /// @inheritdoc IReceiptRegistry
    function exists(bytes32 receiptId) external view returns (bool) {
        return _receipts[receiptId].attestation != Attestation.NONE;
    }

    /// @notice True only for receipts backed by both parties' signatures.
    function isCosigned(bytes32 receiptId) external view returns (bool) {
        return _receipts[receiptId].attestation == Attestation.COSIGNED;
    }

    /// @notice Full receipt record.
    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return _receipts[receiptId];
    }

    /// @inheritdoc IReceiptEvidence
    function receiptEvidence(bytes32 receiptId)
        external
        view
        returns (
            address payer,
            address payee,
            uint256 amount,
            bytes32 toolId,
            uint64 timestamp,
            bool cosigned
        )
    {
        Receipt storage r = _receipts[receiptId];
        return
            (
                r.payer,
                r.payee,
                r.amount,
                r.toolId,
                r.timestamp,
                r.attestation == Attestation.COSIGNED
            );
    }
}
