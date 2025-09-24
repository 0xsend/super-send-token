# SendEarnRewards v2: ERC4626 Aggregator (streaming deferred)

This section documents the v2 design for the ERC4626 wrapper/aggregator. It intentionally defers any streaming/Constant Flow Agreement (CFA) behavior. The existing streaming content remains below, unchanged, as reference material and future work.

Status: Spec only (docs-first). Implementation and tests will follow in separate PRs.

## Goals
- Provide a pooled ERC4626 aggregator that can route deposits into SendEarn ERC4626 vaults while exposing a standard ERC4626 interface to integrators.
- Shares are transferable (standard ERC20 semantics). No non-transferable override.
- No streaming dependencies in this spec. Streaming is deferred.

## Asset and conversions
- The aggregator’s `asset()` equals the underlying asset used by all routed SendEarn vaults (e.g., USDC).
- Follow standard ERC4626 math for conversions; do not assume 1:1 shares/assets. `totalAssets()` reflects the current value of all held SendEarn vault shares converted via each vault’s `convertToAssets`.

```
// Pseudocode for totalAssets
sum over all held SendEarn vaults v:
  total += IERC4626(v).convertToAssets(IERC4626(v).balanceOf(address(this)))
```

## Deposit routing (selection policy)
Resolution order for deposits by caller:
1) If `factory.affiliates(caller) != address(0)`, route deposit to that SendEarn vault.
2) Else, let `d = factory.SEND_EARN()` (the default SendEarn vault). If `IERC20(d).balanceOf(caller) > 0` (caller already holds default shares), prefer `d`.
3) Else, route to `d`.

All routed targets MUST satisfy:
- `factory.isSendEarn(vault) == true`
- `IERC4626(vault).asset() == address(asset())`

## Withdraw policy (gas‑efficient; no loops)
- Withdraw uses a single vault only: resolve the vault via `affiliates(owner)`; if empty, use `SEND_EARN()`.
- Redeem from that resolved vault exclusively; do not loop across multiple vaults.
- If the resolved vault position is insufficient to satisfy the requested assets/shares, revert. A non‑standard helper such as `withdrawFrom(vault, assets)` may be introduced later if finer control is desired.

## Transferability
- Aggregator shares follow normal ERC20 semantics: transfers are allowed. The aggregator does not maintain per‑user vault ledgers.

## Optional onboarding (deferred)
- A future helper like `depositVaultShares(vault, shares)` may be added to onboard existing SendEarn shares. Not part of this spec.

---

# SendEarnRewards (formerly RewardsAggregator): ERC4626-Compatible Wrapper with CFA Flows

The `SendEarnRewards` contract (formerly RewardsAggregator) has been refactored to provide full ERC4626 compatibility while preserving the CFA (Constant Flow Agreement) streaming rewards mechanism. This document explains the changes and usage patterns.

## Overview

The contract now:
- **Inherits from ERC4626** to expose standard vault interface methods
- **Issues non-transferable shares** that can only be minted/burned on deposit/withdraw
- **Routes deposits/withdrawals** into allowed SendEarn ERC4626 vaults
- **Maintains per-user CFA flows** in SENDx proportional to aggregated assets
- **Preserves existing assets ledger** for precise flow calculations

## Key Changes

### ERC4626 Compatibility
The contract now exposes standard ERC4626 methods:
- `deposit(uint256 assets, address receiver)` 
- `withdraw(uint256 assets, address receiver, address owner)`
- `mint(uint256 shares, address receiver)`
- `redeem(uint256 shares, address receiver, address owner)`

### Non-Transferable Shares
Shares cannot be transferred between users. The `_update` override prevents transfers:
```solidity
function _update(address from, address to, uint256 value) internal virtual override {
    if (from != address(0) && to != address(0)) revert("non-transferable");
    super._update(from, to, value);
}
```

This pattern mirrors OpenZeppelin's ERC20Pausable contract.

### Vault Routing Configuration

#### Admin Configuration
- `setDefaultDepositVault(address vault)` - Sets system-wide default vault for new users
- Requires `CONFIG_ROLE` 

#### User Configuration  
- `setDepositVault(address vault)` - Sets caller's preferred vault for ERC4626 operations
- Anyone can call this for their own account

#### Resolution Logic
1. Check user's preferred vault (`depositVaultOf[user]`)
2. Fall back to `defaultDepositVault` if user has no preference
3. Validate vault is allowed via `factory.isSendEarn(vault)`

### ERC4626 Hook Integration

#### Deposit Flow (`_deposit` hook)
1. Standard ERC4626 mint shares to receiver
2. Route underlying assets to user's selected vault
3. Update assets ledger: `assetsByVault[receiver][vault] += assets`
4. Update aggregated total: `totalAssetsByUser[receiver] += assets`
5. Recompute and update CFA flow rate

#### Withdraw Flow (`_withdraw` hook)
1. Withdraw underlying from user's selected vault to contract
2. Standard ERC4626 burn shares and send assets to receiver
3. Update assets ledger: `assetsByVault[owner][vault] -= assets`
4. Update aggregated total: `totalAssetsByUser[owner] -= assets`
5. Recompute and update CFA flow rate

This pattern mirrors SendEarn's `_deposit`/`_withdraw` hooks.

### Wrapper Methods (Backward Compatibility)

The original methods are preserved as ERC4626 wrappers:

#### `depositAssets(address vault, uint256 assets)`
- Sets user's preferred vault to the specified vault
- Calls standard `deposit(assets, msg.sender)`
- Maintains existing event signature

#### `withdrawAssets(address vault, uint256 assets, address receiver)`
- Sets user's preferred vault to the specified vault
- Calls standard `withdraw(assets, receiver, msg.sender)`
- Maintains existing event signature

## Usage Patterns

### For Standard ERC4626 Integration

```solidity
// Set preferred vault (one-time setup)
aggregator.setDepositVault(allowedVaultAddress);

// Standard ERC4626 deposit (routes to preferred vault)
aggregator.deposit(1000e6, msg.sender); // 1000 USDC

// Standard ERC4626 withdraw (routes from preferred vault)
aggregator.withdraw(500e6, msg.sender, msg.sender); // 500 USDC
```

### For Multi-Vault Per-Transaction Control

```solidity
// Deposit into specific vault (sets preference + deposits)
aggregator.depositAssets(vaultA, 1000e6);

// Later, switch to different vault
aggregator.depositAssets(vaultB, 500e6);

// Withdraw from specific vault  
aggregator.withdrawAssets(vaultB, 300e6, msg.sender);
```

### Admin Setup

```solidity
// Set default vault for new users
aggregator.setDefaultDepositVault(primaryVault);

// Configure streaming parameters
aggregator.setAnnualRateBps(300); // 3% APR
aggregator.setExchangeRateWad(1e18); // 1:1 asset to SENDx
```

## Flow Behavior

### CFA Flow Updates
Flows are recalculated on every deposit/withdraw based on:
- `totalAssetsByUser[user]` - aggregated across all vaults
- `annualRateBps` - annual rate in basis points (default 300 = 3%)
- `exchangeRateWad` - asset to SENDx conversion (default 1e18 = 1:1)

### Flow Rate Calculation
```solidity
uint256 valueWad = totalAssetsByUser[user] * exchangeRateWad;
uint256 annualWad = (valueWad * annualRateBps) / 10_000;
uint256 perSecond = annualWad / secondsPerYear / 1e18;
int96 newRate = int96(int256(perSecond));
```

## SENDx Funding

Use the existing `scripts/fund/sendx.ts` to pre-fund the aggregator with SENDx tokens for flow payments:

```bash
# Fund aggregator with 1M units of underlying (e.g., USDC)
AGGREGATOR=0x... FUND_UNDERLYING=1000000 CREATE_WRAPPER=true npm run sendx:fund
```

The script:
1. Resolves/creates SENDx wrapper for the aggregator's asset
2. Upgrades underlying to SENDx  
3. Transfers SENDx to the aggregator contract

## Constructor Changes

The constructor now requires name/symbol parameters for the ERC20 token:

```solidity
constructor(
    address _sendx,
    address _factory, 
    address _asset,
    string memory _name,      // New: ERC20 name
    string memory _symbol,    // New: ERC20 symbol  
    address admin
)
```

## Compatibility Notes

- **Shares are 1:1 with assets** for simple accounting alignment
- **Non-transferable** shares prevent secondary market complications
- **Existing CFA flow logic** is preserved unchanged
- **Assets ledger accounting** continues to drive flow calculations
- **SendEarn vault validation** maintains security properties

The refactored contract provides ERC4626 standardization while preserving the unique CFA streaming rewards mechanism and multi-vault aggregation features.