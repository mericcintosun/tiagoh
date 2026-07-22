// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title DemoToken
/// @notice A clearly-labeled DEMO / TEST payment token used only to exercise tiagoh's x402
///         flow on GOAT during the demo. It is NOT a real stablecoin and carries no value —
///         it is owner-mintable, 6 decimals, and exists purely so the paid-tool flow has a
///         token to move. Replace `payTo`/`asset` with a real GOAT stablecoin for production.
contract DemoToken is ERC20, Ownable2Step {
    constructor(address owner_) ERC20("tiagoh Demo USD (test)", "tUSDdemo") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
