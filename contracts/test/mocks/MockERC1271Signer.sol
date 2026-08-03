// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Minimal ERC-1271 smart account: validates signatures produced by a single owner key.
///         Stands in for an ERC-4337 agent wallet / multisig so tests prove that co-signed
///         receipts and other signature flows accept contract signers, not just EOAs.
contract MockERC1271Signer {
    bytes4 internal constant MAGIC = 0x1626ba7e;

    address public immutable signerKey;

    constructor(address signerKey_) {
        signerKey = signerKey_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signerKey) {
            return MAGIC;
        }
        return 0xffffffff;
    }
}
