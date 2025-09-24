// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// SendEarnRewards: ERC4626-compatible rewards adapter that routes
// deposits/withdraws into allowed SendEarn ERC4626 vaults (factory-gated),
// using the same "super" hook pattern as SendEarn to bubble calls into the
// underlying vault. Positions remain non-transferable (shares only mint/burn).
// Existing SendEarn users can "join" by calling depositAssets(vault, 0)
// to set their preferred vault mapping without moving funds.

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { ISuperfluidToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluidToken.sol";

interface IMinimalSendEarnFactory {
    function isSendEarn(address target) external view returns (bool);
}

interface IMinimalHost {
    function callAgreement(address agreementClass, bytes calldata callData, bytes calldata userData) external returns (bytes memory returnedData);
    function getAgreementClass(bytes32 agreementType) external view returns (address);
}

interface IMinimalCFAv1 {
    function createFlow(address token, address receiver, int96 flowRate, bytes calldata ctx) external returns (bytes memory newCtx);
    function updateFlow(address token, address receiver, int96 flowRate, bytes calldata ctx) external returns (bytes memory newCtx);
    function deleteFlow(address token, address sender, address receiver, bytes calldata ctx) external returns (bytes memory newCtx);
}

interface IMinimalCFAv1Read {
    function getFlow(address token, address sender, address receiver) external view returns (uint256 timestamp, int96 flowRate, uint256 deposit, uint256 owedDeposit);
}

contract SendEarnRewards is ERC4626, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    // Superfluid payout token (SENDx)
    ISuperfluidToken public immutable sendx;

    // Gate for vault acceptance
    IMinimalSendEarnFactory public immutable factory;

    // Per-user per-vault assets ledger (contract holds the actual vault shares)
    mapping(address => mapping(address => uint256)) public assetsByVault; // user => vault => assets
    mapping(address => uint256) public totalAssetsByUser; // aggregated per-user assets

    // per-user flow rate cache
    mapping(address => int96) public flowRateByUser;

    // streaming config
    uint96 public annualRateBps = 300; // 3%
    uint256 public secondsPerYear = 365 days;
    uint256 public exchangeRateWad = 1e18; // asset->SENDx conversion

    // default and per-user preferred SendEarn vault routing
    address public defaultDepositVault;
    mapping(address => address) public depositVaultOf;

    event Deposited(address indexed user, address indexed vault, uint256 assetsIn, int96 newRate);
    event Withdrawn(address indexed user, address indexed vault, uint256 assetsOut, int96 newRate);
    event FlowSet(address indexed user, int96 oldRate, int96 newRate);
    event ConfigUpdated(uint96 annualRateBps, uint256 secondsPerYear, uint256 exchangeRateWad);
    event VaultPreferenceSet(address indexed user, address indexed vault);

    constructor(
        address _sendx,
        address _factory,
        address _asset,
        string memory _name,
        string memory _symbol,
        address admin
    ) ERC4626(IERC20(_asset)) ERC20(_name, _symbol) {
        require(_sendx != address(0), "sendx");
        require(_factory != address(0), "factory");
        require(_asset != address(0), "asset");
        require(admin != address(0), "admin");
        sendx = ISuperfluidToken(_sendx);
        factory = IMinimalSendEarnFactory(_factory);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
    }

    // Non-transferable shares (mint/burn only)
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert("non-transferable");
        super._update(from, to, value);
    }

    // ERC4626 public entry points (reentrancy guarded) that bubble into hooks
    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256 shares) {
        return super.deposit(assets, receiver);
    }
    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256 assets) {
        return super.mint(shares, receiver);
    }
    function withdraw(uint256 assets, address receiver, address owner) public override nonReentrant returns (uint256 shares) {
        return super.withdraw(assets, receiver, owner);
    }
    function redeem(uint256 shares, address receiver, address owner) public override nonReentrant returns (uint256 assets) {
        return super.redeem(shares, receiver, owner);
    }

    // 1:1 shares<->assets to keep accounting simple while we aggregate across SendEarn vaults
    function totalAssets() public view override returns (uint256) { return totalSupply(); }
    function _convertToShares(uint256 assets, Math.Rounding) internal view override returns (uint256) { return assets; }
    function _convertToAssets(uint256 shares, Math.Rounding) internal view override returns (uint256) { return shares; }

    // Hook pattern (like SendEarn): super then interact with target vault
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        address v = _resolveVault(receiver);
IERC20(asset()).forceApprove(v, 0);
        IERC20(asset()).forceApprove(v, assets);
        IERC4626(v).deposit(assets, address(this));
        assetsByVault[receiver][v] += assets;
        totalAssetsByUser[receiver] += assets;
        int96 rate = _recomputeAndSetFlow(receiver);
        emit Deposited(receiver, v, assets, rate);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        address v = _resolveVault(owner);
        uint256 bal = assetsByVault[owner][v];
        require(bal >= assets, "assets>bal");
        IERC4626(v).withdraw(assets, address(this), address(this));
        super._withdraw(caller, receiver, owner, assets, shares);
        assetsByVault[owner][v] = bal - assets;
        totalAssetsByUser[owner] = totalAssetsByUser[owner] - assets;
        int96 rate = _recomputeAndSetFlow(owner);
        emit Withdrawn(owner, v, assets, rate);
    }

    // Preferred vault wrappers
    // Allows joining with assets=0 to set mapping without moving funds
    function depositAssets(address vault, uint256 assets) external nonReentrant {
        address v = _validateVault(vault);
        depositVaultOf[msg.sender] = v;
        emit VaultPreferenceSet(msg.sender, v);
        if (assets > 0) {
            super.deposit(assets, msg.sender);
        }
    }
    function withdrawAssets(address vault, uint256 assets, address receiver) external nonReentrant {
        address v = _validateVault(vault);
        depositVaultOf[msg.sender] = v;
        emit VaultPreferenceSet(msg.sender, v);
        if (assets > 0) {
            address to = receiver == address(0) ? msg.sender : receiver;
            super.withdraw(assets, to, msg.sender);
        }
    }

    // Views
    function getUserVaultAssets(address who, address vault) external view returns (uint256) { return assetsByVault[who][vault]; }
    function getFlowRate(address who) external view returns (int96) { return flowRateByUser[who]; }

    // Admin config
    function setAnnualRateBps(uint96 bps) external onlyRole(CONFIG_ROLE) { require(bps <= 10_000, "bps"); annualRateBps = bps; emit ConfigUpdated(annualRateBps, secondsPerYear, exchangeRateWad); }
    function setSecondsPerYear(uint256 secs) external onlyRole(CONFIG_ROLE) { require(secs > 0, "secs"); secondsPerYear = secs; emit ConfigUpdated(annualRateBps, secondsPerYear, exchangeRateWad); }
    function setExchangeRateWad(uint256 wad) external onlyRole(CONFIG_ROLE) { require(wad > 0, "rate"); exchangeRateWad = wad; emit ConfigUpdated(annualRateBps, secondsPerYear, exchangeRateWad); }
    function setDefaultDepositVault(address vault) external onlyRole(CONFIG_ROLE) { defaultDepositVault = _validateVault(vault); }
    function setDepositVault(address vault) external { depositVaultOf[msg.sender] = _validateVault(vault); emit VaultPreferenceSet(msg.sender, depositVaultOf[msg.sender]); }

    // helpers
    function _validateVault(address input) internal view returns (address v) {
        require(input != address(0), "vault");
        require(factory.isSendEarn(input), "not SendEarn");
        v = input;
        require(IERC4626(v).asset() == address(asset()), "asset mismatch");
    }
    function _resolveVault(address user) internal view returns (address v) {
        v = depositVaultOf[user];
        if (v == address(0)) v = defaultDepositVault;
        require(v != address(0), "no vault");
        require(factory.isSendEarn(v), "not SendEarn");
        require(IERC4626(v).asset() == address(asset()), "asset mismatch");
    }

    function _recomputeAndSetFlow(address user) internal returns (int96 newRate) {
        uint256 valueWad = totalAssetsByUser[user] * exchangeRateWad;
        uint256 annualWad = (valueWad * annualRateBps) / 10_000;
        uint256 perSec = secondsPerYear == 0 ? 0 : annualWad / secondsPerYear / 1e18;
        if (perSec > uint256(uint96(type(int96).max))) perSec = uint256(uint96(type(int96).max));
        newRate = int96(int256(perSec));
        int96 old = flowRateByUser[user];
        if (newRate == old) return newRate;
        address host = sendx.getHost();
        address cfa = IMinimalHost(host).getAgreementClass(keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1"));
        (, int96 current, ,) = IMinimalCFAv1Read(cfa).getFlow(address(sendx), address(this), user);
        if (newRate == 0) {
            if (current != 0) {
                IMinimalHost(host).callAgreement(cfa, abi.encodeWithSelector(IMinimalCFAv1.deleteFlow.selector, address(sendx), address(this), user, new bytes(0)), new bytes(0));
            }
        } else {
            if (current == 0) {
                IMinimalHost(host).callAgreement(cfa, abi.encodeWithSelector(IMinimalCFAv1.createFlow.selector, address(sendx), user, newRate, new bytes(0)), new bytes(0));
            } else {
                IMinimalHost(host).callAgreement(cfa, abi.encodeWithSelector(IMinimalCFAv1.updateFlow.selector, address(sendx), user, newRate, new bytes(0)), new bytes(0));
            }
        }
        flowRateByUser[user] = newRate;
        emit FlowSet(user, old, newRate);
        return newRate;
    }
}
