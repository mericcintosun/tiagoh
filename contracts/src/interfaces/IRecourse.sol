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

    /// @notice Release a held escrow to the payee (a seller-favourable ruling).
    function release(uint256 escrowId) external;

    /// @notice Freeze a held escrow for the duration of a dispute, so neither party can settle
    ///         it out from under the arbiter.
    function freeze(uint256 escrowId) external;

    /// @notice Lift a freeze without moving funds, letting the normal claim path resume.
    function unfreeze(uint256 escrowId) external;

    /// @dev Purpose-built read (NOT the packed struct's auto-getter, which would couple
    ///      consumers to field declaration order). `state` is EscrowVault.State's uint8
    ///      backing, where 1 = HELD.
    function escrowParties(uint256 escrowId)
        external
        view
        returns (
            address payer,
            address payee,
            uint256 amount,
            bytes32 toolId,
            uint8 state,
            bool disputed
        );
}
