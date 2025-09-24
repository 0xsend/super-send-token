# SendEarnRewards v2: ERC4626 Aggregator (streaming deferred)

This section documents the v2 design for the ERC4626 wrapper/aggregator. It intentionally defers any streaming/Constant Flow Agreement (CFA) behavior. The existing streaming content remains below, unchanged, as reference material and future work.

Status: Spec only (docs-first). Implementation and tests will follow in separate PRs.

## Goals
- Provide a pooled ERC4626 aggregator that can route deposits into SendEarn ERC4626 vaults while exposing a standard ERC4626 interface to integrators.
- Shares are transferable (standard ERC20 semantics). No non-transferable override.
- No streaming dependencies in this spec. Streaming is deferred.

## Data model and asset/conversions
- Per-user per-vault underlying shares: the wrapper attributes underlying SendEarn vault shares to users in `_userUnderlyingShares[user][vault]`.
- Active vaults (wrapper-wide): first time a deposit is made into a vault, it’s added to `_activeVaults` for view-only `totalAssets()`.
- Active vaults (per-user): first time a user receives underlying shares for a vault, it’s added to that user’s active set for proportional re‑attribution on ERC20 transfers (no external calls).

## Asset, conversions, and NAV-based accounting (v2.0)
- ERC4626 aggregator with `asset()` equal to the underlying asset used by all SendEarn vaults (e.g., USDC).
- NAV-based share pricing (standard ERC4626 math): aggregator shares represent a pro‑rata claim on the total aggregated assets held via SendEarn vault shares.
- Conversions (no 1:1 simplification):
  - `totalAssets()` equals the sum, over all tracked vaults `v`, of `IERC4626(v).convertToAssets(IERC4626(v).balanceOf(address(this)))`.
  - `_convertToShares(assets)` and `_convertToAssets(shares)` use standard ERC4626 formulas based on current `totalAssets()` and `totalSupply()`.

### Deposit interfaces
There are two complementary ways to contribute value:

1) Ingest existing SendEarn vault shares (non‑standard): `depositVaultShares(vault, shares)`
   - Preconditions: `factory.isSendEarn(vault)` and `IERC4626(vault).asset() == asset()`.
   - Flow:
     1) Pull `shares` from the user into the aggregator (transferFrom)
     2) `assetsEq = IERC4626(vault).convertToAssets(shares)`
     3) Mint aggregator shares using NAV: `minted = _convertToShares(assetsEq, …)`
     4) Per‑user ledger: `_userUnderlyingShares[user][vault] += shares`
     5) Track vault in `_activeVaults` if first use
     6) Emit `Deposited(user, vault, assetsEq, shares)`

2) Standard ERC4626 deposit of underlying: `deposit(assets, receiver)`
   - Resolution: `vault = affiliates(receiver)` if non‑zero else `SEND_EARN()`
   - Flow:
     1) Mint aggregator shares using NAV: `minted = _convertToShares(assets, …)`
     2) Aggregator deposits `assets` into `vault`, receiving `vaultShares`
     3) Per‑user ledger: `_userUnderlyingShares[receiver][vault] += vaultShares`
     4) Track vault in `_activeVaults` if first use
     5) Emit `Deposited(receiver, vault, assets, vaultShares)`

### Withdraw and Redeem (single‑vault, no loops)
- `withdraw(assets, receiver, owner)`
  - `vault = affiliates(owner)` if non‑zero else `SEND_EARN()`
  - `sharesNeeded = IERC4626(vault).previewWithdraw(assets)`
  - Require `_userUnderlyingShares[owner][vault] >= sharesNeeded`
  - Redeem `sharesNeeded` from `vault` to the aggregator, then send `assets` to `receiver`
  - Burn aggregator shares using NAV: `_convertToShares(assets, …)`
  - `_userUnderlyingShares[owner][vault] -= sharesNeeded`
  - Emit `Withdrawn(owner, vault, assets, sharesNeeded)`

- `redeem(shares, receiver, owner)`
  - Resolve `vault` as above
  - Redeem underlying vault shares sufficient to produce `assetsOut`, send to `receiver`
  - Update per‑user ledger and burn aggregator shares using NAV

### Transfers
- ERC20 transfers of aggregator shares DO NOT modify per‑user underlying ledgers.
- Flows (CFA) are updated only on deposit/withdraw/redeem (see CFA v2.1).
- The aggregator’s `asset()` equals the underlying asset used by all routed SendEarn vaults (e.g., USDC).
- Follow standard ERC4626 math for conversions; do not assume 1:1 shares/assets. `totalAssets()` reflects the current value of all held SendEarn vault shares converted via each vault’s `convertToAssets`.

```
// Pseudocode for totalAssets
sum over all held SendEarn vaults v:
  total += IERC4626(v).convertToAssets(IERC4626(v).balanceOf(address(this)))
```

## Deposit routing (selection policy)
Resolution order for each action (deposit/withdraw):
- Use `affiliates(account)` if non-zero; else `SEND_EARN()`.
- Note: Changing your affiliate does not migrate legacy underlying shares. It only affects future actions’ resolution.
  - Example: if you deposited into default vault and later set an affiliate to a different vault, withdraw resolves to the new affiliate vault and will revert unless you hold underlying shares there.
Resolution order for deposits by caller:
1) If `factory.affiliates(caller) != address(0)`, route deposit to that SendEarn vault.
2) Else, let `d = factory.SEND_EARN()` (the default SendEarn vault). If `IERC20(d).balanceOf(caller) > 0` (caller already holds default shares), prefer `d`.
3) Else, route to `d`.

All routed targets MUST satisfy:
- `factory.isSendEarn(vault) == true`
- `IERC4626(vault).asset() == address(asset())`

## Withdraw policy (gas‑efficient; no loops)
- Withdraw uses a single vault only: resolve the vault via `affiliates(owner)`; if empty, use `SEND_EARN()`.
- Redeem from that resolved vault exclusively; do not call multiple vaults.
- If the resolved vault position is insufficient to satisfy the requested assets/shares, revert.
- A non‑standard helper such as `withdrawFrom(vault, assets)` may be introduced later for finer control.

## Transfers (re‑attribute underlying shares, no external calls)
- Wrapper shares are transferable.
- On transfer, the wrapper proportionally re‑attributes the sender’s underlying shares across the sender’s active vaults to the receiver in proportion to the transferred wrapper shares over the sender’s pre‑transfer wrapper balance.
- This is an in‑memory loop over the sender’s active vault list; no vault external calls are made.
- Practical effect: the receiver can withdraw from any vaults the sender had underlying shares in (subject to the receiver’s affiliate resolution at withdraw time).
- Withdraw uses a single vault only: resolve the vault via `affiliates(owner)`; if empty, use `SEND_EARN()`.
- Redeem from that resolved vault exclusively; do not loop across multiple vaults.
- If the resolved vault position is insufficient to satisfy the requested assets/shares, revert. A non‑standard helper such as `withdrawFrom(vault, assets)` may be introduced later if finer control is desired.

## Total assets (view-only)
- `totalAssets()` sums across wrapper-held positions:
  - For each tracked vault `v` in `_activeVaults`:
    - `assets += IERC4626(v).convertToAssets(IERC4626(v).balanceOf(address(this)))`
- This is a view-only iteration. State-changing flows remain single-vault without loops.
- Conversions use NAV (no 1:1 shortcut).

## CFA streaming integration (v2.1) — Professional spec

Status: planned (docs-first); implementation follows. The flowRate calculation component is not finalized; all calls to `flow` are placeholders pending that integration.

### Purpose and scope
- Provide continuous SENDx streaming to users sized by the value of their aggregated SendEarn positions held via the aggregator.
- Integrate Superfluid using SuperTokenV1Library `flow` helper to create/update/delete flows on state changes.
- Scope covers deposit (vault token ingestion), withdraw, and redeem. ERC20 share transfers do not alter ledger or flows.

### Definitions
- Vault: a SendEarn ERC4626 vault approved by the factory.
- Vault shares: ERC4626 shares of a SendEarn vault (seASSET tokens) held by the aggregator.
- Aggregated assets (per user): sum over user’s vaults of `IERC4626(v).convertToAssets(userUnderlyingShares[v])`.
- sendx: the SuperToken used for streaming (constructor arg). Must be pre-funded in the aggregator.

### External dependencies
- Superfluid protocol; use `SuperTokenV1Library` for `flow(ISuperToken token, address receiver, int96 rate)`.
- SendEarnFactory (gating): `isSendEarn(vault)`; `SEND_EARN()` default vault.
- ERC4626 interface: `convertToAssets(shares)`, `convertToShares(assets)`.

### State model (relevant to streaming)
- Per-user, per-vault underlying shares:
  - `_userUnderlyingShares[user][vault] -> uint256`
- Wrapper-wide active vaults (for view-only aggregation):
  - `_activeVaults[]` and `_isActiveVault[vault]`
- Note: we do not modify per-user ledgers on ERC20 transfers. Flows/ledgers are updated only on deposit/withdraw/redeem.

### Invariants
- Vault gating: `factory.isSendEarn(vault) == true` before accepting any vault shares.
- Asset invariant: `IERC4626(vault).asset() == asset()` of the aggregator.
- Single-vault mutations: withdraw/redeem operate on a single, resolved vault per action; no multi-vault loops.
- No ledger changes on ERC20 share transfers.

### Resolution policy
- For any action on behalf of `account`: resolve `vault = factory.affiliates(account)` if non-zero; else `factory.SEND_EARN()`.
- Affiliate changes affect future actions only; existing per-user vault share ledgers are not migrated.

### Flows and triggers
- Trigger `_recomputeAndFlow(user)` after:
  - Deposit (vault token ingestion)
  - Withdraw (assets)
  - Redeem (shares)
- Transfers DO NOT trigger flow updates.

### Flow rate policy (placeholder)
- `flowRate = f(aggregatedAssets(user), policy)` where:
  - `aggregatedAssets(user) = Σ_v convertToAssets(_userUnderlyingShares[user][v])`
  - Policy inputs (configurable): `annualRateBps`, `secondsPerYear`, `exchangeRateWad`
- Compute per-second rate (placeholder):
  - `valueWad = aggregatedAssets * exchangeRateWad`
  - `annualWad = valueWad * annualRateBps / 10_000`
  - `perSecond = floor(annualWad / secondsPerYear / 1e18)`
  - `rate = int96(perSecond)`; if `rate == 0`, delete flow
- NOTE: Final policy/oracle component to be integrated; until then, treat `flow()` invocations as stubs.

### Lifecycle flows

#### Deposit (vault token ingestion)
1) User transfers SendEarn vault shares to SendEarnRewards (e.g., `depositVaultShares(vault, shares)`).
2) Validate: `factory.isSendEarn(vault)` and `IERC4626(vault).asset() == asset()`.
3) Compute assets: `assets = IERC4626(vault).convertToAssets(shares)` (beware rounding; prefer protocol’s conversion semantics).
4) Ledger updates:
   - `_userUnderlyingShares[user][vault] += shares` (store underlying shares to preserve precise value accrual semantics)
   - Optionally maintain `totalAssetsByUser[user]` in view-only helpers by summing conversions on demand.
5) Track wrapper-wide vault activity: add `vault` to `_activeVaults` if first use.
6) Stream update (placeholder): call `sendx.flow(user, flowRate)`.
7) Events: `Deposited(user, vault, assets, shares)`.

#### Withdraw (assets)
1) Resolve vault; compute required shares: `shares = IERC4626(vault).previewWithdraw(assets)`.
2) Verify user ledger has at least `shares` recorded; redeem from `vault` to this contract; send assets to `receiver=user`.
3) Ledger updates: `_userUnderlyingShares[user][vault] -= shares`.
4) Stream update (placeholder): call `sendx.flow(user, flowRate)`.
5) Events: `Withdrawn(user, vault, assets, shares)`.

#### Redeem (shares)
1) Resolve vault and redeem directly in shares path.
2) Convert shares→assets via `IERC4626(vault).redeem(shares, this, this)` then send assets to `receiver=user`.
3) Ledger updates and stream update as in Withdraw.

### Rounding and decimals
- Use ERC4626 preview functions for forward-looking conversions (`previewWithdraw`, `previewRedeem`).
- When converting vault shares to assets for aggregation, use `convertToAssets(shares)`; rounding follows the vault’s ERC4626 implementation.

### Reentrancy and safety
- Wrap public entry points with `nonReentrant`.
- Use `forceApprove` (reset-to-zero then set) for ERC20 approvals.
- Never loop across multiple vaults in state-changing flows.

### Observability
- Events: `Deposited(user, vault, assets, underlyingShares)`, `Withdrawn(user, vault, assets, underlyingShares)`.
- Views: `userUnderlyingShares(user, vault)`, `totalAssets()` (wrapper-wide; view-only over `_activeVaults`).

### Failure modes
- Not SendEarn vault: revert.
- Asset mismatch: revert.
- Insufficient underlying shares on Withdraw/Redeem: revert.
- Flow creation/update may revert if SENDx buffer is insufficient (operator choice: pre-fund or skip flow set).

### Implementation notes
- Keep vault interaction minimal and single-target per action.
- Flow update hooks are invoked after ledger mutation for the acting user.
- Do not attempt to adjust flows on ERC20 transfers.

### Open items
- Plug in final flowRate component (oracle/policy); unit test flow lifecycle after integration.
- Optional: on admin policy change, batch-recompute flows across a given user subset.
Status: planned in v2.1 (docs-first; implementation next). Note: we do not yet have the final flowRate calculation component; calls to `flow` should be treated as placeholders until that piece is finalized.

Library
- Use Superfluid’s SuperTokenV1Library `flow(ISuperToken token, address receiver, int96 rate)` to create/update/delete flows.

Deposit (vault token ingestion)
1) User deposits a SendEarn vault token (shares) into SendEarnRewards.
2) SendEarnRewards checks `factory.isSendEarn(vault)`.
3) SendEarnRewards computes assets for the vault: `assets = IERC4626(vault).convertToAssets(shares)`.
4) SendEarnRewards updates its internal mappings linking vaults ⇄ users ⇄ assets (e.g., `assetsByVault[user][vault] += assets`, `totalAssetsByUser[user] += assets`).
5) SendEarnRewards calls `sendx.flow(user, flowRate)` via the library to reflect the new aggregated assets (flowRate: TODO — pending final component).

Withdraw
1) SendEarnRewards withdraws assets held by the SendEarn underlying vault for the caller (redeeming vault shares it holds on behalf of the user). Receiver is the user linked to the vault.
2) SendEarnRewards updates mappings (decrement the user’s assets for that vault and total assets).
3) SendEarnRewards calls `sendx.flow(user, flowRate)` to reflect the reduced aggregated assets (flowRate: TODO — pending final component).

Redeem
- Same as withdraw but the entry uses shares (wrapper redeem path should convert shares → assets and follow the same mapping + flow update sequence).

Notes
- Exact `flowRate` computation is intentionally left as a TODO. We will integrate the final component (oracle/policy) to determine `flowRate` from the user’s aggregated assets.
- This flow does not rely on re-attributing underlying shares during ERC20 transfers. Flows and mappings update on deposit/withdraw/redeem only.

References
- SuperTokenV1Library: https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol
- CFA docs: https://docs.superfluid.finance/superfluid/developers/constant-flow-agreement-cfa

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