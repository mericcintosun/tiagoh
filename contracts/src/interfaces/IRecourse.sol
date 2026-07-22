// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Recourse interfaces
/// @notice Minimal surfaces of the contracts an arbiter drives on a buyer-favorable
///         ruling, plus the read surface used to validate dispute inputs at open time
///         (so an attacker cannot point a dispute at someone else's escrow or bond).
interface IQualityBondSlasher {
    function slash(bytes32 toolId, uint256 amount, address to) external;

    /// @dev Auto-getter of QualityBond.bonds — Tier is returned as its uint8 backing.
    function bonds(bytes32 toolId)
        external
        view
        returns (address seller, uint256 amount, uint8 tier, bool active, uint256 unlockAt);

    function bondAmount(bytes32 toolId) external view returns (uint256);
}

interface IEscrowRefunder {
    function refund(uint256 escrowId) external;

    /// @dev Auto-getter of EscrowVault.escrows — State is returned as its uint8 backing
    ///      (1 = HELD), the token as its address.
    function escrows(uint256 escrowId)
        external
        view
        returns (
            address payer,
            address payee,
            address token,
            uint256 amount,
            uint256 deadline,
            bytes32 cascadeId,
            uint8 state
        );
}
