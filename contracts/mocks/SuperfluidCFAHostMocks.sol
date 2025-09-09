// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMinimalCFAv1Like {
    function createFlow(address token, address receiver, int96 flowRate, bytes calldata ctx) external returns (bytes memory);
    function updateFlow(address token, address receiver, int96 flowRate, bytes calldata ctx) external returns (bytes memory);
    function deleteFlow(address token, address sender, address receiver, bytes calldata ctx) external returns (bytes memory);
}
interface IMinimalCFAv1ReadLike {
    function getFlow(address token, address sender, address receiver) external view returns (uint256, int96, uint256, uint256);
}

contract CFAMock is IMinimalCFAv1Like, IMinimalCFAv1ReadLike {
    address public host;
    constructor(address _host) { host = _host; }
    function setHost(address _host) external { host = _host; }

    struct Flow { int96 rate; uint256 timestamp; uint256 deposit; uint256 owedDeposit; }
    mapping(address => mapping(address => mapping(address => Flow))) public flows;
    address private _tmpSender;
    modifier onlyHost() { require(msg.sender == host, "only host"); _; }
    function setTmpSender(address s) external onlyHost { _tmpSender = s; }

    function createFlow(address token, address receiver, int96 flowRate, bytes calldata) external override onlyHost returns (bytes memory) {
        address sender = _tmpSender; flows[token][sender][receiver] = Flow({ rate: flowRate, timestamp: block.timestamp, deposit: 0, owedDeposit: 0 }); return bytes("");
    }
    function updateFlow(address token, address receiver, int96 flowRate, bytes calldata) external override onlyHost returns (bytes memory) {
        address sender = _tmpSender; Flow storage f = flows[token][sender][receiver]; f.rate = flowRate; f.timestamp = block.timestamp; return bytes("");
    }
    function deleteFlow(address token, address sender, address receiver, bytes calldata) external override onlyHost returns (bytes memory) {
        Flow storage f = flows[token][sender][receiver]; f.rate = 0; f.timestamp = block.timestamp; return bytes("");
    }
    function getFlow(address token, address sender, address receiver) external view override returns (uint256, int96, uint256, uint256) {
        Flow memory f = flows[token][sender][receiver]; return (f.timestamp, f.rate, f.deposit, f.owedDeposit);
    }
}

contract HostMock {
    bytes32 public constant CFA_ID = keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    address public cfa;
    constructor(address _cfa) { cfa = _cfa; }
    function getAgreementClass(bytes32 agreementType) external view returns (address) { require(agreementType == CFA_ID, "bad id"); return cfa; }
    function callAgreement(address agreementClass, bytes calldata callData, bytes calldata) external returns (bytes memory) {
        require(agreementClass == cfa, "bad class"); (bool ok1,) = agreementClass.call(abi.encodeWithSignature("setTmpSender(address)", msg.sender)); require(ok1, "tmpSender"); (bool ok, bytes memory ret) = agreementClass.call(callData); require(ok, "callAgreement failed"); return ret;
    }
}

contract SuperTokenMock {
    address public host;
    constructor(address _host) { host = _host; }
    function getHost() external view returns (address) { return host; }
}
