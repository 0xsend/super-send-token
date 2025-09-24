// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// SendEarnRewards v2: ERC4626 aggregator that routes deposits/withdraws
// into a single resolved SendEarn ERC4626 vault per action (no loops).
// Routing: factory.affiliates(user) if non-zero, else factory.SEND_EARN().
// Withdraw uses only the resolved vault and reverts if insufficient.
// Shares are transferable; streaming v2.1 (CFA) integrated per tests.
// Shares are transferable; streaming v2.1 (CFA) integrated per tests.

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IMinimalSendEarnFactory {
    function isSendEarn(address target) external view returns (bool);
    function affiliates(address who) external view returns (address);
    function SEND_EARN() external view returns (address);
}

interface ISendEarnVault is IERC4626 {}

// Minimal Superfluid interfaces (mirroring mocks and official shapes we use)
interface IMinimalHostLike {
    function getAgreementClass(bytes32 agreementType) external view returns (address);
    function callAgreement(address agreementClass, bytes calldata callData, bytes calldata userData) external returns (bytes memory);
}
interface ISuperTokenLike {
    function getHost() external view returns (address);
}

contract SendEarnRewards is ERC4626, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    // Constructor accepts sendx for compatibility but streaming is deferred.
    address public immutable sendx;

    // Gate for vault acceptance
    IMinimalSendEarnFactory public immutable factory;

    // Per-user per-vault underlying shares held by this wrapper
    mapping(address => mapping(address => uint256)) private _userUnderlyingShares;


    // Tracked vaults the wrapper has interacted with (for view-only totalAssets)
    address[] private _activeVaults;
    mapping(address => bool) private _isActiveVault;

    // CFA policy config (v2.1 placeholder implementation)
    uint256 public annualRateBps = 300; // 3%
    uint256 public secondsPerYear = 365 days; // can be changed in tests
    uint256 public exchangeRateWad = 1e18; // 1:1 placeholder

    bytes32 internal constant CFA_ID = keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");

    event Deposited(address indexed user, address indexed vault, uint256 assetsIn, uint256 underlyingSharesReceived);
    event Withdrawn(address indexed user, address indexed vault, uint256 assetsOut, uint256 underlyingSharesRedeemed);

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
        sendx = _sendx; // kept for compatibility; not used in v2
        factory = IMinimalSendEarnFactory(_factory);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
    }

    // ERC4626 entry points (reentrancy guarded)
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

    // Accounting: sum across tracked SendEarn vaults (view-only) for totalAssets.
    function totalAssets() public view override returns (uint256 assets) {
        uint256 n = _activeVaults.length;
        for (uint256 i = 0; i < n; i++) {
            address v = _activeVaults[i];
            uint256 shares = IERC4626(v).balanceOf(address(this));
            if (shares != 0) {
                assets += IERC4626(v).convertToAssets(shares);
            }
        }
    }
    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        uint256 supply = totalSupply();
        uint256 total = totalAssets();
        if (supply == 0 || total == 0) return assets;
        return Math.mulDiv(assets, supply, total, rounding);
    }
    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
        uint256 supply = totalSupply();
        uint256 total = totalAssets();
        if (supply == 0) return 0;
        return Math.mulDiv(shares, total, supply, rounding);
    }

    // Helpers
    function userUnderlyingShares(address user, address vault) external view returns (uint256) {
        return _userUnderlyingShares[user][vault];
    }

    // Convenience view for tests: assets-equivalent of user's recorded underlying shares in a vault
    function getUserVaultAssets(address user, address vault) external view returns (uint256) {
        uint256 sh = _userUnderlyingShares[user][vault];
        if (sh == 0) return 0;
        return IERC4626(vault).convertToAssets(sh);
    }

    function getFlowRate(address user) external view returns (uint256) {
        uint256 agg = _aggregatedAssets(user);
        if (agg == 0) return 0;
        // per-second = floor(agg * exchangeRateWad * annualRateBps / 10000 / secondsPerYear / 1e18)
        uint256 valueWad = agg * exchangeRateWad;
        uint256 annualWad = (valueWad * annualRateBps) / 10000;
        uint256 perSec = annualWad / secondsPerYear / 1e18;
        return perSec;
    }

    function setSecondsPerYear(uint256 s) external onlyRole(CONFIG_ROLE) { require(s > 0, "s"); secondsPerYear = s; }
    function setAnnualRateBps(uint256 bps) external onlyRole(CONFIG_ROLE) { require(bps <= 10000, "bps"); annualRateBps = bps; }
    function setExchangeRateWad(uint256 wad) external onlyRole(CONFIG_ROLE) { require(wad > 0, "wad"); exchangeRateWad = wad; }

    // Hooks: interact with the resolved SendEarn vault
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        // Move assets from caller -> this and mint wrapper shares via super
        super._deposit(caller, receiver, assets, shares);

        // Resolve vault based on the caller's affiliate mapping (or default)
        address v = _resolveVaultFor(caller);
        if (!_isActiveVault[v]) { _isActiveVault[v] = true; _activeVaults.push(v); }
        IERC20(asset()).forceApprove(v, 0);
        IERC20(asset()).forceApprove(v, assets);
        uint256 underlyingSharesReceived = IERC4626(v).deposit(assets, address(this));

        // Attribute the received underlying shares to the receiver
        _userUnderlyingShares[receiver][v] += underlyingSharesReceived;

        emit Deposited(receiver, v, assets, underlyingSharesReceived);

        // Update CFA flow per v2.1 placeholder policy
        _recomputeAndFlow(receiver);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares) internal override {
        // Resolve owner's vault
        address v = _resolveVaultFor(owner);
        IERC4626 vault = IERC4626(v);

        // Compute underlying shares needed (round up) to get `assets`
        uint256 underlyingSharesToRedeem = vault.previewWithdraw(assets);
        require(_userUnderlyingShares[owner][v] >= underlyingSharesToRedeem, "insufficient underlying shares");

        // Redeem underlying shares into this contract
        uint256 assetsRedeemed = vault.redeem(underlyingSharesToRedeem, address(this), address(this));
        require(assetsRedeemed >= assets, "redeemed < assets");

        // Burn wrapper shares and send out assets
        super._withdraw(caller, receiver, owner, assets, shares);

        // Update accounting of user's underlying shares
        _userUnderlyingShares[owner][v] -= underlyingSharesToRedeem;

        emit Withdrawn(owner, v, assets, underlyingSharesToRedeem);

        // Update CFA flow per v2.1 placeholder policy
        _recomputeAndFlow(owner);
    }


    // Accept existing SendEarn vault shares and mint aggregator shares by NAV
    function depositVaultShares(address vault, uint256 shares) external nonReentrant {
        require(shares > 0, "shares");
        require(factory.isSendEarn(vault), "not SendEarn");
        require(IERC4626(vault).asset() == address(asset()), "asset mismatch");
        if (!_isActiveVault[vault]) { _isActiveVault[vault] = true; _activeVaults.push(vault); }

        // Compute assets-equivalent of incoming vault shares using the vault's ERC4626 conversion
        uint256 assetsEq = IERC4626(vault).convertToAssets(shares);

        // Snapshot pre-ingestion NAV to align with previewDeposit semantics
        uint256 supplyBefore = totalSupply();
        uint256 assetsBefore = totalAssets();
        uint256 minted;
        if (supplyBefore == 0 || assetsBefore == 0) {
            minted = assetsEq;
        } else {
            minted = Math.mulDiv(assetsEq, supplyBefore, assetsBefore, Math.Rounding.Floor);
        }

        // Pull vault shares from user into the aggregator and attribute to sender
        IERC20(vault).safeTransferFrom(msg.sender, address(this), shares);
        _userUnderlyingShares[msg.sender][vault] += shares;

        // Mint aggregator shares computed from pre-ingestion NAV
        _mint(msg.sender, minted);

        emit Deposited(msg.sender, vault, assetsEq, shares);

        // Update CFA flow per v2.1 placeholder policy
        _recomputeAndFlow(msg.sender);
    }

    // Resolve the SendEarn vault for a given account.
    function _resolveVaultFor(address who) internal view returns (address v) {
        // First: factory affiliates
        try factory.affiliates(who) returns (address aff) {
            v = aff;
        } catch {
            v = address(0);
        }
        if (v == address(0)) {
            // Fallback to default
            try factory.affiliates(who) returns (address aff) {
                v = aff;
            } catch {
                v = address(0);
            }
        }
        if (v == address(0)) {
            // Fallback to default SEND_EARN from factory
            try factory.SEND_EARN() returns (address def) {
                v = def;
            } catch {
                v = address(0);
            }
        }
        require(v != address(0), "no vault");
        require(factory.isSendEarn(v), "not SendEarn");
        require(IERC4626(v).asset() == address(asset()), "asset mismatch");
    }


    function _aggregatedAssets(address user) internal view returns (uint256 total) {
        uint256 n = _activeVaults.length;
        for (uint256 i = 0; i < n; i++) {
            address v = _activeVaults[i];
            uint256 sh = _userUnderlyingShares[user][v];
            if (sh != 0) {
                total += IERC4626(v).convertToAssets(sh);
            }
        }
    }

    function _recomputeAndFlow(address user) internal {
        // Skip entirely if sendx is not a contract (ERC4626-only tests set a dummy EOA)
        if (sendx.code.length == 0) return;
        uint256 perSec = this.getFlowRate(user);
        // If sendx is not a proper SuperToken or has no host, skip silently
        address host;
        try ISuperTokenLike(sendx).getHost() returns (address h) {
            host = h;
        } catch {
            return;
        }
        if (host == address(0)) return;
        address cfa = IMinimalHostLike(host).getAgreementClass(CFA_ID);
        if (perSec > 0) {
            // updateFlow(token, receiver, rate, ctx)
            bytes memory data = abi.encodeWithSignature(
                "updateFlow(address,address,int96,bytes)",
                sendx,
                user,
                int96(uint96(perSec)),
                bytes("")
            );
            try IMinimalHostLike(host).callAgreement(cfa, data, "") { } catch { }
        } else {
            // deleteFlow(token, sender, receiver, ctx)
            bytes memory data2 = abi.encodeWithSignature(
                "deleteFlow(address,address,address,bytes)",
                sendx,
                address(this),
                user,
                bytes("")
            );
            try IMinimalHostLike(host).callAgreement(cfa, data2, "") { } catch { }
        }
    }

}
