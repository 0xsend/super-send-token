// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// This contract mirrors established patterns in this repo and SendEarn ERC-4626 usage:
// - We read vault.asset(), balanceOf, and convertToAssets to compute assets per vault.
//   Reference (share->asset conversions):
//   /Users/vict0xr/Documents/Send/send-earn-contracts/src/SendEarn.sol
// - We create and administer the Superfluid pool in the constructor using SuperTokenV1Library.
//   This ensures the pool admin is this contract, allowing it to update member units directly.
// No novel distribution patterns are introduced; we only sum assets across many vaults of the same underlying.

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { ISuperfluidToken } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluidToken.sol";
import { ISuperfluidPool } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/gdav1/ISuperfluidPool.sol";
import { IGeneralDistributionAgreementV1, PoolConfig } from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/gdav1/IGeneralDistributionAgreementV1.sol";

/// Minimal host interface to fetch agreement classes without importing the full ISuperfluid (which pulls IERC777).
interface IMinimalSuperfluid {
    function getAgreementClass(bytes32 agreementType) external view returns (address);
}

/// Minimal SendEarnFactory interface used for validation and affiliate->vault normalization.
/// Example source: send-earn-contracts/src/interfaces/ISendEarnFactory.sol
/// Functions mirrored: isSendEarn(address), affiliates(address)
interface IMinimalSendEarnFactory {
    function isSendEarn(address target) external view returns (bool);
    function affiliates(address affiliate) external view returns (address);
}

/// @title RewardsManager
/// @notice Tracks per-user assets across multiple ERC-4626 vaults that share the same underlying asset (e.g., USDC),
///         and mirrors the total assets to Superfluid Pool units. Callers are expected to invoke sync on deposit/withdraw.
contract RewardsManager is AccessControl {
    using SafeCast for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// Roles
    bytes32 public constant SEND_ACCOUNT_ROLE = keccak256("SEND_ACCOUNT_ROLE");
    bytes32 public constant SYNC_OPERATOR_ROLE = keccak256("SYNC_OPERATOR_ROLE");

    /// @dev Super Token used as the pool payout asset (SENDx).
    ISuperfluidToken public immutable sendx;

    /// @dev The single underlying asset (e.g., USDC) that all managed vaults must use.
    IERC20 public immutable asset;

    /// @dev Superfluid pool created in the constructor with this contract as admin.
    ISuperfluidPool public immutable pool;

    /// @dev SendEarn factory used to validate vaults and normalize affiliate addresses.
    IMinimalSendEarnFactory public immutable sendEarnFactory;

    /// @dev Minimum assets (in smallest units of the underlying) required to keep a (user, vault) entry tracked.
    uint256 public minAssets;

    /// @dev Per-user last recorded assets per vault.
    mapping(address => mapping(address => uint256)) public lastAssetsByVault; // user => vault => assets

    /// @dev Per-user total assets across all previously synced vaults.
    mapping(address => uint256) public totalAssetsByUser;

    /// @dev Enumerability helpers (optional, for off-chain discovery and chunked syncs).
    EnumerableSet.AddressSet private trackedUsers;
    mapping(address => EnumerableSet.AddressSet) private userVaults;

    event SyncedVault(address indexed who, address indexed vault, uint256 assets, uint128 newUnits);
    event PoolCreated(address indexed admin, ISuperfluidToken indexed token, ISuperfluidPool indexed pool);
    event MinAssetsUpdated(uint256 oldMin, uint256 newMin);

    constructor(
        address _sendx,
        address _sendEarnFactory,
        address _asset,
        address admin,
        uint256 _minAssets
    ) {
        require(_sendx != address(0), "sendx");
        require(_sendEarnFactory != address(0), "sendEarnFactory");
        require(_asset != address(0), "asset");
        require(admin != address(0), "admin");
        require(_minAssets > 0, "minAssets");

        // 1) Use provided SuperToken wrapper
        sendx = ISuperfluidToken(_sendx);

        // 2) Store references
        asset = IERC20(_asset);
        sendEarnFactory = IMinimalSendEarnFactory(_sendEarnFactory);

        // Set minimum assets threshold from constructor
        minAssets = _minAssets;

        // 3) Create the Superfluid Pool with this contract as admin
        address host = sendx.getHost();
        address gdaAddr = IMinimalSuperfluid(host).getAgreementClass(
            keccak256("org.superfluid-finance.agreements.GeneralDistributionAgreement.v1")
        );
        IGeneralDistributionAgreementV1 gda = IGeneralDistributionAgreementV1(gdaAddr);
        pool = gda.createPool(
            sendx,
            address(this),
            PoolConfig({ transferabilityForUnitsOwner: false, distributionFromAnyAddress: true })
        );
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        emit PoolCreated(admin, sendx, pool);
    }

    /// @notice Sync a vault for msg.sender.
    /// @dev Permissionless: anyone may trigger an update based on on-chain balances.
    function syncVault(address vault) external {
        address resolved = _normalizeVault(vault);
        _syncVaultFor(resolved, msg.sender);
    }

    /// @notice Sync a vault for an arbitrary user.
    /// @dev Permissionless: anyone may trigger an update for `who`.
    function syncVault(address vault, address who) external {
        address resolved = _normalizeVault(vault);
        _syncVaultFor(resolved, who);
    }

    /// @notice Batch sync many vaults for msg.sender.
    /// @dev Permissionless; caller provides vault list and pays gas.
    function batchSyncVaults(address[] calldata vaults) external {
        address who = msg.sender;
        uint256 n = vaults.length;
        for (uint256 i = 0; i < n; i++) {
            address resolved = _normalizeVault(vaults[i]);
            _syncVaultFor(resolved, who);
        }
    }

    /// @notice Batch sync many vaults for an arbitrary user.
    /// @dev Permissionless; use reasonable batch sizes to avoid out-of-gas.
    function batchSyncVaults(address[] calldata vaults, address who) external {
        uint256 n = vaults.length;
        for (uint256 i = 0; i < n; i++) {
            address resolved = _normalizeVault(vaults[i]);
            _syncVaultFor(resolved, who);
        }
    }

    function _normalizeVault(address input) internal view returns (address v) {
        require(input != address(0), "vault");
        if (sendEarnFactory.isSendEarn(input)) {
            v = input;
        } else {
            address underlying = sendEarnFactory.affiliates(input);
            require(underlying != address(0), "invalid vault");
            v = underlying;
        }
        // Enforce single-asset invariant (e.g., USDC)
        require(IERC4626(v).asset() == address(asset), "asset mismatch");
    }

    function _syncVaultFor(address vault, address who) internal {
        // Calculate current assets for `who` in this vault
        uint256 shares = IERC20(vault).balanceOf(who);
        uint256 currentAssets = shares == 0 ? 0 : IERC4626(vault).convertToAssets(shares);

        uint256 prev = lastAssetsByVault[who][vault];
        lastAssetsByVault[who][vault] = currentAssets;

        if (currentAssets >= prev) {
            totalAssetsByUser[who] += (currentAssets - prev);
        } else {
            totalAssetsByUser[who] -= (prev - currentAssets);
        }

        // Maintain enumerability sets based on threshold
        if (currentAssets >= minAssets) {
            trackedUsers.add(who);
            userVaults[who].add(vault);
        } else {
            // Remove this vault if it no longer meets threshold
            if (userVaults[who].contains(vault)) {
                userVaults[who].remove(vault);
            }
            // If user has no more qualifying vaults, remove the user
            if (userVaults[who].length() == 0) {
                trackedUsers.remove(who);
            }
        }

        uint128 units = totalAssetsByUser[who].toUint128(); // cast safe for typical ranges
        pool.updateMemberUnits(who, units);
        emit SyncedVault(who, vault, currentAssets, units);
    }

    // ----------------------
    // Admin configuration
    // ----------------------
    function setMinAssets(uint256 newMin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 old = minAssets;
        minAssets = newMin;
        emit MinAssetsUpdated(old, newMin);
    }

    // ----------------------
    // Enumeration views
    // ----------------------
    function getTrackedUserCount() external view returns (uint256) {
        return trackedUsers.length();
    }

    function getTrackedUserAt(uint256 index) external view returns (address) {
        return trackedUsers.at(index);
    }

    function getUserVaultCount(address who) external view returns (uint256) {
        return userVaults[who].length();
    }

    function getUserVaultAt(address who, uint256 index) external view returns (address) {
        return userVaults[who].at(index);
    }

    // ----------------------
    // Chunked sync helpers (use small ranges to bound gas)
    // ----------------------
    function syncUserVaults(address who, uint256 start, uint256 count) external {
        uint256 n = userVaults[who].length();
        if (start >= n) return;
        uint256 end = start + count;
        if (end > n) end = n;
        for (uint256 i = start; i < end; i++) {
            address v = userVaults[who].at(i);
            _syncVaultFor(v, who);
        }
    }

    function syncUsersRange(uint256 start, uint256 count) external {
        uint256 nUsers = trackedUsers.length();
        if (start >= nUsers) return;
        uint256 end = start + count;
        if (end > nUsers) end = nUsers;
        for (uint256 i = start; i < end; i++) {
            address u = trackedUsers.at(i);
            uint256 nVaults = userVaults[u].length();
            for (uint256 j = 0; j < nVaults; j++) {
                address v = userVaults[u].at(j);
                _syncVaultFor(v, u);
            }
        }
    }
}
