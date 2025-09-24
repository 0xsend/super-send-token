// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @title ISendEarnRewards
/// @notice ERC4626-compatible aggregator interface with CFA configuration and
///         per-vault accounting helpers.
/// @dev Mirrors SendEarn-style interface patterns; routing is determined by
///      affiliates(caller) on the factory with fallback to SEND_EARN().
interface ISendEarnRewards is IERC4626, IAccessControl {
    /* EVENTS */
    event Deposited(
        address indexed user,
        address indexed vault,
        uint256 assetsIn,
        uint256 underlyingSharesReceived
    );

    event Withdrawn(
        address indexed user,
        address indexed vault,
        uint256 assetsOut,
        uint256 underlyingSharesRedeemed
    );

    /* CORE GETTERS */

    /// @notice SuperToken used for streaming (CFA v2.1 integration)
    function sendx() external view returns (address);

    /// @notice SendEarnFactory providing vault gating and affiliate routing
    function factory() external view returns (address);

    /* CFA POLICY CONFIG */

    /// @notice Annual streaming rate in basis points (e.g., 300 = 3%)
    function annualRateBps() external view returns (uint256);

    /// @notice Seconds per year used for per-second rate computation
    function secondsPerYear() external view returns (uint256);

    /// @notice Exchange rate (wad) for asset→SENDx value; placeholder for policy/oracle
    function exchangeRateWad() external view returns (uint256);

    /* VIEWS */

    /// @notice Per-user underlying shares recorded for a given SendEarn vault
    function userUnderlyingShares(address user, address vault) external view returns (uint256);

    /// @notice Convenience: assets-equivalent for a user's recorded underlying shares in a given vault
    function getUserVaultAssets(address user, address vault) external view returns (uint256);

    /// @notice Per-second SENDx flow rate sized by aggregated assets (policy placeholder)
    function getFlowRate(address user) external view returns (uint256);

    /* MUTATIONS */

    /// @notice Ingest existing SendEarn vault shares and mint aggregator shares per NAV
    /// @param vault The SendEarn ERC4626 vault address (must pass factory gating and asset invariant)
    /// @param shares Amount of vault shares to transfer into the aggregator
    function depositVaultShares(address vault, uint256 shares) external;

    /* ADMIN (CONFIG_ROLE) */

    /// @notice Set secondsPerYear used for per-second rate computation
    function setSecondsPerYear(uint256 s) external;

    /// @notice Set annual streaming rate in basis points
    function setAnnualRateBps(uint256 bps) external;

    /// @notice Set exchange rate (wad) used in flow sizing policy
    function setExchangeRateWad(uint256 wad) external;
}
