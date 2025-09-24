# SendEarnRewards Aggregator – Temporary Design Reminder (delete later)

Status: Temporary notes to guide implementation decisions. Safe to delete after alignment.

## Short answer

Yes, it makes sense to front SendEarn with a separate ERC4626 “aggregator” vault that:
- Holds SendEarn vault shares in its own custody, so accounting is authoritative and actions are visible
- Exposes the standard ERC4626 interface (deposit/withdraw) for composability
- Adds a non-standard path to onboard existing SendEarn shares (transfer them in)
- Avoids upgrading SendEarn (no user migrations), preserves ERC4626 utility for integrators, and lets you aggregate value across vaults you control

## Desired behavior (restated)
- Calling `deposit` on the aggregator should deposit underlying into a factory-approved SendEarn ERC4626 vault (and thus into its underlying), with the aggregator holding the resulting SendEarn shares.
- Calling `withdraw` on the aggregator should withdraw from the SendEarn vault (and underlying), reducing the aggregator’s SendEarn share holdings accordingly.
- For users already holding SendEarn shares, provide a function to transfer those shares into the aggregator. The aggregator mints new shares representing the user’s stake and updates flows based on underlying-equivalent value.

This mirrors SendEarn’s super-hook behavior while centralizing custody of the SendEarn shares in the aggregator.

## Why a separate ERC4626 wrapper-vault is a good fit
- ERC4626 single-asset constraint: a single ERC4626 must accept one `asset()` token. We keep the aggregator’s asset as the underlying (e.g., USDC); deposits are routed to a chosen SendEarn vault (all sharing the same underlying). The aggregator holds the resulting SendEarn shares.
- Composability: integrators use ERC4626 deposit/withdraw; aggregator handles routing/bubbling into SendEarn and custody of SendEarn shares.
- Onboarding existing SendEarn share-holders: add a non-standard `depositVaultShares(vault, shares)` that pulls SendEarn shares from the user, mints aggregator shares equal to `convertToAssets(shares)`, and updates flows.
- No migrations: no need to upgrade SendEarn or require user migrations. Users deposit into the aggregator, or transfer their existing shares into it.
- Observability and correctness: since the aggregator holds the SendEarn shares, we can enforce withdraws through the aggregator and compute value via `vault.convertToAssets(heldShares)` at any time.

## Design details to get right
- Per-user accounting: track per-user, per-vault shares; compute underlying-equivalent assets via `convertToAssets(shares)` for flows and displays.
- ERC4626 “bubbling”: in `_deposit`, call `super._deposit` then deposit underlying into the selected SendEarn vault and hold shares; in `_withdraw`, withdraw underlying back from the SendEarn vault, then `super._withdraw`.
- Existing share intake: `depositVaultShares(vault, shares)`:
  - `transferFrom` SendEarn shares into the aggregator
  - `assetsEq = vault.convertToAssets(shares)`
  - mint aggregator shares equal to `assetsEq`
  - update per-vault/user ledger and flows
- Optional: share-return exit path `withdrawVaultShares(vault, shares)` (burn aggregator shares and transfer SendEarn shares back). Keep ERC4626 `withdraw` for the underlying exit expected by integrators.
- Multi-vault aggregation & exits:
  - ERC4626 `withdraw(assets)` lacks a vault parameter; choose an exit policy (mapping-based, pro-rata, or add a non-standard `withdrawFrom(vault, assets)`). Start with mapping-based for simplicity.
- Flow sizing and accrual: flows update at action boundaries (deposit/withdraw/intake). If you want continuously-accurate flows, add a maintenance function (e.g., `updateFlows(user)` or batch) that recomputes using current `convertToAssets(shares)`.

## Tradeoffs vs upgrading SendEarn
- Upgrading SendEarn:
  - Pros: native flows; fewer moving parts
  - Cons: migration/user coordination, more risk, compatibility concerns
- Aggregator ERC4626:
  - Pros: migration-free; preserves ERC4626 composability; easy to add share-intake; central policy control
  - Cons: one more contract; exit routing policy needed across multi-vault holdings

## Recommended shape (concrete)
- Keep aggregator as ERC4626 with `asset()` = underlying
- Retain super-hook routing so ERC4626 deposit/withdraw bubble into/out of the chosen SendEarn vault; hold SendEarn shares in aggregator
- Add `depositVaultShares(vault, shares)` onboarding path for existing SendEarn share-holders. Consider optional `withdrawVaultShares` for share exits
- Pick a clear withdraw policy (mapping-based to start) and document it
- Flows computed from `vault.convertToAssets(userShares)`; update flows on each action

## Open questions / next choices
- Do we want a share-return exit path (`withdrawVaultShares`) from the aggregator alongside ERC4626 withdraw?
- Which exit policy do we standardize on for ERC4626 withdraw across multiple held vaults (mapping-based vs pro-rata)?
- Should aggregator shares be non-transferable (simpler for flows) or transferable (more utility for integrations)? Current default: non-transferable

---
Temporary reminder; safe to delete after alignment.
