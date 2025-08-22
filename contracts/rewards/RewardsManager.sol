// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Rule 3 note:
// This contract mirrors the minimal pattern described in Superfluid's Distribution Pools (GDA) docs
// for updating pool units to match an external ERC-20 balance source. We avoid novel patterns and
// only include functions we can mirror from examples. Pool creation is left to scripts (admin = this),
// keeping on-chain logic minimal and example-aligned.
//
// References:
// - Pools/GDA guide: https://docs.superfluid.org/docs/protocol/distributions/guides/pools
// - Example operations: updateMemberUnits(member, units)
// - We intentionally do not embed SuperTokenV1Library usage here to avoid guessing signatures.
//   A deploy script will create the pool with this contract as admin, then pass the pool address.

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

interface ISuperfluidPool {
    // Mirrors the method name from Superfluid pool examples; return value (if any) is ignored.
    function updateMemberUnits(address member, uint128 units) external;
}

/// @title RewardsManager
/// @notice Mirrors ERC-4626 share balances into Superfluid Pool units (1:1, cast to uint128).
///         Pool is expected to be created with this contract as admin by an external script.
contract RewardsManager is AccessControl {
    using SafeCast for uint256;

    /// @dev Super Token used as the pool payout asset (SENDx). Stored for reference/logging only in this phase.
    address public immutable sendx;

    /// @dev ERC-20 share token (ERC-4626 shares) whose balances define pool units.
    IERC20 public immutable shareToken;

    /// @dev Superfluid pool to update units on.
    ISuperfluidPool public immutable pool;

    event Synced(address indexed who, uint128 units);

    constructor(address _sendx, address _shareToken, address _pool, address admin) {
        require(_sendx != address(0), "sendx");
        require(_shareToken != address(0), "share");
        require(_pool != address(0), "pool");
        require(admin != address(0), "admin");
        sendx = _sendx;
        shareToken = IERC20(_shareToken);
        pool = ISuperfluidPool(_pool);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Set pool units for `who` to their current share balance (cast to uint128).
    /// @dev Open to anyone; cannot arbitrarily set units — only mirrors on-chain share balance.
    function sync(address who) public {
        require(who != address(0), "zero");
        uint256 bal = shareToken.balanceOf(who);
        uint128 units = bal.toUint128();
        pool.updateMemberUnits(who, units);
        emit Synced(who, units);
    }

    /// @notice Batch variant of sync.
    function batchSync(address[] calldata who) external {
        uint256 n = who.length;
        for (uint256 i = 0; i < n; i++) {
            sync(who[i]);
        }
    }
}
