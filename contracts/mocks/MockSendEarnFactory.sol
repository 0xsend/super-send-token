// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMinimalSendEarnFactory {
    function isSendEarn(address target) external view returns (bool);
    function affiliates(address affiliate) external view returns (address);
}

contract MockSendEarnFactory is IMinimalSendEarnFactory {
    mapping(address => bool) public isSendEarnMapping;
    mapping(address => address) public affiliateToUnderlying;

    function setIsSendEarn(address target, bool val) external {
        isSendEarnMapping[target] = val;
    }

    function setAffiliate(address affiliate, address underlying) external {
        affiliateToUnderlying[affiliate] = underlying;
    }

    function isSendEarn(address target) external view returns (bool) {
        return isSendEarnMapping[target];
    }

    function affiliates(address affiliate) external view returns (address) {
        return affiliateToUnderlying[affiliate];
    }
}

