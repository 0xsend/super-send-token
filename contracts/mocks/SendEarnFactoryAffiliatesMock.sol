// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Test-only mock that mirrors the minimal surface we need from ISendEarnFactory for v2 routing tests.
// Source of truth (example used): send-earn-contracts/src/interfaces/ISendEarnFactory.sol
// Correlation: exposes affiliates(address)->address, isSendEarn(address)->bool, and SEND_EARN()->address
// to drive routing decisions in tests without importing full factory code.

interface IMinimalFactoryLike {
    function isSendEarn(address target) external view returns (bool);
    function affiliates(address who) external view returns (address);
    function SEND_EARN() external view returns (address);
}

contract SendEarnFactoryAffiliatesMock is IMinimalFactoryLike {
    mapping(address => bool) public override isSendEarn;
    mapping(address => address) public override affiliates;
    address public override SEND_EARN;

    function setIsSendEarn(address target, bool allowed) external {
        isSendEarn[target] = allowed;
    }

    function setAffiliate(address who, address vault) external {
        affiliates[who] = vault;
    }

    function setSendEarn(address vault) external {
        SEND_EARN = vault;
    }
}
