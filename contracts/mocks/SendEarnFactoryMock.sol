// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMinimalSendEarnFactoryLike {
    function isSendEarn(address target) external view returns (bool);
}

contract SendEarnFactoryMock is IMinimalSendEarnFactoryLike {
    mapping(address => bool) public override isSendEarn;

    function setIsSendEarn(address target, bool allowed) external {
        isSendEarn[target] = allowed;
    }
}
