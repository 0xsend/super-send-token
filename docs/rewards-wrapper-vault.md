# ERC‑4626 Wrapper‑Vault for Rewards (assets‑normalized)

Status: Proposal (docs-only PR)

## 1) Goals
- Keeperless unit updates: pool member units update in the same transaction as user balance changes (deposit/withdraw/transfer).
- Assets-normalized rewards: units represent economic value via convertToAssets/preview flows, not raw share counts.
- First-class ERC4626: present a familiar interface with preview/max* semantics and a clear accounting invariant.
- Safe Superfluid integration: use protocol pool contracts; pool admin is the wrapper with transferabilityForUnitsOwner=false.
- Minimal external calls: interact with the underlying vault only at necessary boundaries (afterDeposit/beforeWithdraw) and avoid read loops.

## 2) Non-goals (for this prototype)
- Cross-chain or multi-network coordination.
- Price oracles beyond ERC4626 exchange rate (no USD-pegged logic).
- Upgradeability pattern selection (non-upgradeable for now).

## 3) Terminology
- Underlying: ERC20 asset accepted by the underlying target ERC4626 vault.
- Target vault: existing ERC4626 vault (e.g., SendEarn) that accrues yield.
- Wrapper-vault: this new ERC4626 contract; holds target vault shares, issues its own shares to users.
- Units: Superfluid pool member units; assets-normalized measure used to split distributions.

## 4) High-level design (V1: assets-normalized per user, aggregated)
- Aggregated across SendEarn vaults that share the same underlying asset (uniform asset invariant).
- The contract accepts deposits targeted to a specific SendEarn vault (validated) and holds the resulting vault shares; positions are non-transferable (no P2P share transfers).
- Withdrawals mirror back from the specified vault.
- Units (per user) = sum over all tracked SendEarn vaults of convertToAssets(userSharesInVault), cast to uint128.
- Pool config: non-transferable units; distributionFromAnyAddress configurable (default true for dev convenience).

## 5) Invariants
- Uniform asset: All accepted SendEarn vaults MUST have IERC4626(v).asset() == address(asset).
- Vault allowlist: Only vaults created by SendEarnFactory are accepted (factory.isSendEarn(v) == true).
- totalAssets (global): Sum of underlying-equivalent held across all accepted SendEarn vaults by this contract.
- For each user u: units(u) = Σ_v floor(convertToAssets(userSharesInVault[v])).
- Units update on deposit/withdraw for the specific vault; positions are non-transferable to simplify updates.
- No direct user custody of target shares: the contract holds SendEarn shares corresponding to ledgered user balances.

## 6) Integration points (non-transferable positions)
- depositAssets(vault, assets): validate isSendEarn(vault) and asset match; transfer underlying from user; approve+deposit into vault to this contract; credit user’s per-vault shares; update units for user by adding convertToAssets(sharesMinted).
- withdrawAssets(vault, assets): validate vault; compute shares via previewWithdraw; debit user’s per-vault shares; withdraw to user; update units by subtracting convertToAssets(sharesBurned).
- No peer-to-peer transfer path: positions are not transferable to avoid extra unit update hooks.

## 7) Superfluid pool wiring
- Single aggregated pool across all accepted SendEarn vaults.
- Create the pool in the constructor with PoolConfig{ transferabilityForUnitsOwner: false, distributionFromAnyAddress: true }.
- The contract is the pool admin (only it updates member units).
- Member lifecycle: connect on first positive units; do not disconnect (optional). Units govern the share regardless of connection status; claimAll works for late connections.

## 8) Public methods (external surface)
- deposit(uint256 assets, address receiver)
- mint(uint256 shares, address receiver)
- withdraw(uint256 assets, address receiver, address owner)
- redeem(uint256 shares, address receiver, address owner)
- Standard ERC4626 views: asset(), totalAssets(), convertToAssets(), convertToShares(), previewDeposit/Withdraw/Mint/Redeem, maxDeposit/Withdraw/Mint/Redeem.
- Pool views: pool(), unitsOf(address)

## 9) Units update strategy
- On depositAssets: add convertToAssets(sharesMinted) to the user’s aggregated assets and updateMemberUnits(user, floor(sumAssets)).
- On withdrawAssets: subtract convertToAssets(sharesBurned) and update units accordingly (floor).
- No transfer path to handle.
- Casting and rounding: use ERC4626 preview/convert and floor; cast to uint128; add guardrails against overflow (practical ranges only).

## 10) Multi-vault aggregation (optional)
- Preferred for clarity: one wrapper and pool per target vault.
- If aggregation is desired: maintain a set of target vaults; store per-vault positions; units = sum(convertToAssets_per_vault(balance_per_vault)). This adds complexity and must respect gas limits.

## 11) Distribution policy (ensure flowRate is large enough)
- Continuous (preferred): superToken.distributeFlow(pool, flowRate), with flowRate sized from the 3% annual budget converted to SENDx via oracle.
  - Guard: only start/continue flow while floor(flowRate / totalUnits) >= 1 wei/sec per unit. If not, pause/switch to periodic until the budget or TVL makes it viable.
- Periodic (fallback): superToken.distribute(pool, amount) and/or claimAll; compute amount for the period from the 3% annual budget in SENDx.
- Oracle-driven budget: total3PercentPerYearInSENDx = oracle(asset→SENDx, Σ_v convertToAssets(contractSharesInVault[v])) × 0.03.

## 12) Security and validation
- Vault validation: require SendEarnFactory.isSendEarn(vault) and IERC4626(vault).asset() == asset.
- Reentrancy: guard deposit/withdraw paths and pool updates; use checks-effects-interactions.
- Approvals: use safe approve patterns (forceApprove) to the target vault.
- Slippage: respect preview* and max*; handle zero/edge amounts; ensure sufficient liquidity for withdraw.
- Access control: only the aggregator updates units; no user ability to update units directly.

## 13) Gas and rounding
- Unit updates are O(1) per affected account; no loops over all members.
- Rounding floors on ERC4626 preview; consider dust behavior. Document that tiny flows may floor to zero per unit if totalUnits is very large.

## 14) Test plan (follow-up PRs)
- Unit tests
  - Deposit/mint updates units to convertToAssets(balance).
  - Withdraw/redeem reduces units accordingly.
  - Transfer of wrapper shares updates units for both from and to.
  - totalAssets tracks targetVault balance via convertToAssets.
  - Pool distribution correctness for simple cases; rounding behavior.
- Integration
  - With live Superfluid Host+CFA on a fork: create pool, distribute and distributeFlow.
  - With SendEarn as the target vault: deposit/withdraw paths using real ERC4626 behavior.

## 15) Migration and UX
- Users deposit/withdraw via wrapper only; document that direct interaction with the target vault won’t earn rewards.
- Optional helper scripts to route initial balances into the wrapper.

## 16) Open questions
- Connect/disconnect policy: auto-connect on first deposit, disconnect on zero balance?
- Single pool per vault vs. aggregated pool: start per-vault for clarity?
- Flow vs. periodic: default to flow in dev; periodic for low-rate scenarios.

## 17) References (correlating examples in repos)
- Set units (existing pattern): contracts/rewards/RewardsManager.sol updateMemberUnits usage.
- Asset flow pattern (approve+deposit): send-earn-contracts SendEarnFactory.createAndDeposit.
- Superfluid pool creation: RewardsManager constructor using GDAv1 PoolConfig.
