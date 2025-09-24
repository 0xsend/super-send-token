// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// SendEarnRewards v2: ERC4626 aggregator that routes deposits/withdraws
// into a single resolved SendEarn ERC4626 vault per action (no loops).
// Routing: factory.affiliates(user) if non-zero, else factory.SEND_EARN().
// Withdraw uses only the resolved vault and reverts if insufficient.
// Shares are transferable; streaming deferred.

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
    function _convertToShares(uint256 assets, Math.Rounding) internal view override returns (uint256) { return assets; }
    function _convertToAssets(uint256 shares, Math.Rounding) internal view override returns (uint256) { return shares; }

    // Helpers
    function userUnderlyingShares(address user, address vault) external view returns (uint256) {
        return _userUnderlyingShares[user][vault];
    }

    // Hooks: interact with the resolved SendEarn vault
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        // Move assets from caller -> this and mint wrapper shares via super
        super._deposit(caller, receiver, assets, shares);

        // Resolve receiver's vault and deposit underlying assets
        address v = _resolveVaultFor(receiver);
        if (!_isActiveVault[v]) { _isActiveVault[v] = true; _activeVaults.push(v); }
        IERC20(asset()).forceApprove(v, 0);
        IERC20(asset()).forceApprove(v, assets);
        uint256 underlyingSharesReceived = IERC4626(v).deposit(assets, address(this));

        // Attribute the received underlying shares to the receiver
        _userUnderlyingShares[receiver][v] += underlyingSharesReceived;

        emit Deposited(receiver, v, assets, underlyingSharesReceived);
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
    }

    // Resolve the SendEarn vault for a given account.
    function _resolveVaultFor(address who) internal view returns (address v) {
        v = factory.affiliates(who);
        if (v == address(0)) {
            v = factory.SEND_EARN();
        }
        require(v != address(0), "no vault");
        require(factory.isSendEarn(v), "not SendEarn");
        require(IERC4626(v).asset() == address(asset()), "asset mismatch");
    }

}
