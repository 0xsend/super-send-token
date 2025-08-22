// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.28;

interface ISendLockbox {
    event Deposit(address indexed to, uint256 amount);

    function deposit(uint256 amount) external;
    function depositTo(address to, uint256 amount) external;
}
