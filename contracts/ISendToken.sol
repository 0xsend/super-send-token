// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ISendToken is IERC20 {
    function mint(address to, uint256 amount) external;
}