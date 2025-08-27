// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Example reference: OpenZeppelin ERC20 implementation (installed via devDependencies)
// Path: node_modules/@openzeppelin/contracts/token/ERC20/ERC20.sol
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory _name, string memory _symbol, uint8 decimals_) ERC20(_name, _symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

