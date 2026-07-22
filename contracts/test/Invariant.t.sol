// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {EscrowVault} from "../src/EscrowVault.sol";
import {CascadeController} from "../src/CascadeController.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Handler that drives random deposit/release/refund traffic against an EscrowVault.
///         Tracks the total tokens the vault SHOULD still hold, so the invariant can assert
///         solvency under any interleaving of operations.
contract EscrowHandler is Test {
    EscrowVault public vault;
    MockERC20 public token;
    address public arbiter;

    uint256[] public ids;
    uint256 public totalHeld; // sum of amounts still in HELD state

    constructor(EscrowVault _vault, MockERC20 _token, address _arbiter) {
        vault = _vault;
        token = _token;
        arbiter = _arbiter;
    }

    function deposit(uint96 amount, address payee) external {
        amount = uint96(bound(amount, 1, 1_000e6));
        if (payee == address(0)) payee = address(0xBEEF);
        token.mint(address(this), amount);
        token.approve(address(vault), amount);
        uint256 id = vault.deposit(payee, address(token), amount, 1 days, bytes32(0));
        ids.push(id);
        totalHeld += amount;
    }

    function release(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        (,,, uint256 amount,,, EscrowVault.State state) = vault.escrows(id);
        if (state != EscrowVault.State.HELD) return;
        vault.release(id); // this contract is the payer
        totalHeld -= amount;
    }

    function refundExpired(uint256 seed) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        (,,, uint256 amount,,, EscrowVault.State state) = vault.escrows(id);
        if (state != EscrowVault.State.HELD) return;
        vm.warp(block.timestamp + 2 days); // past the deadline
        vault.refund(id);
        totalHeld -= amount;
    }
}

contract EscrowSolvencyInvariant is StdInvariant, Test {
    EscrowVault internal vault;
    MockERC20 internal token;
    EscrowHandler internal handler;
    address internal owner = address(0xA0);

    function setUp() public {
        vault = new EscrowVault(owner);
        token = new MockERC20("USD", "USD", 6);
        handler = new EscrowHandler(vault, token, owner);
        targetContract(address(handler));
    }

    /// @dev The vault must always hold at least the tokens owed to still-HELD escrows. If this
    ///      ever fails, some escrow could not be refunded/released — an insolvency bug.
    function invariant_vaultIsSolvent() public view {
        assertGe(token.balanceOf(address(vault)), handler.totalHeld(), "vault under-collateralized");
    }
}

/// @notice Drives cascade open/pay/close and asserts spent never exceeds budget.
contract CascadeHandler is Test {
    CascadeController public cascade;
    MockERC20 public token;
    uint256[] public ids;

    constructor(CascadeController _c, MockERC20 _t) {
        cascade = _c;
        token = _t;
    }

    function open(uint96 budget) external {
        budget = uint96(bound(budget, 1, 1_000e6));
        token.mint(address(this), budget);
        token.approve(address(cascade), budget);
        ids.push(cascade.openCascade(address(token), budget));
    }

    function payHop(uint256 seed, uint96 amount, address payee) external {
        if (ids.length == 0) return;
        if (payee == address(0) || payee == address(cascade)) payee = address(0xBEEF);
        uint256 id = ids[seed % ids.length];
        (,, uint256 budget, uint256 spent,, bool open_) = cascade.cascades(id);
        if (!open_) return;
        uint256 remaining = budget - spent;
        amount = uint96(bound(amount, 0, remaining));
        if (amount == 0) return;
        cascade.payHop(id, 0, payee, amount, 0);
    }
}

contract CascadeBudgetInvariant is StdInvariant, Test {
    CascadeController internal cascade;
    MockERC20 internal token;
    CascadeHandler internal handler;
    address internal owner = address(0xA0);

    function setUp() public {
        cascade = new CascadeController(owner);
        token = new MockERC20("USD", "USD", 6);
        handler = new CascadeHandler(cascade, token);
        targetContract(address(handler));
    }

    /// @dev spent must never exceed budget for any cascade (the on-chain budget cap holds).
    function invariant_spentNeverExceedsBudget() public view {
        uint256 n = cascade.cascadeCount();
        for (uint256 i = 1; i <= n; i++) {
            (,, uint256 budget, uint256 spent,,) = cascade.cascades(i);
            assertLe(spent, budget, "cascade overspent its budget");
        }
    }
}
