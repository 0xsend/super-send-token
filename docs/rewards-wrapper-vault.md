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

## 4) High-level design
- The wrapper’s asset = the underlying ERC20 of the target vault.
- Deposits: users supply underlying to wrapper; wrapper deposits into target vault (to self), then mints wrapper shares to users.
- Withdrawals: wrapper burns wrapper shares and withdraws/redeems from target vault to pull underlying; sends underlying to receiver.
- Units = wrapper.convertToAssets(balanceOf(user)) (cast to uint128). Units are set/updated when balances change.
- Pool config: non-transferable units; distributionFromAnyAddress configurable (default true for dev convenience).

## 5) Invariants
- totalAssets() returns the underlying-equivalent held via the target vault: totalAssets = targetVault.convertToAssets(targetShareBalanceOf(wrapper)).
- For each user u: units(u) = floor(convertToAssets(wrapperShares(u))).
- On deposit/mint/withdraw/redeem/transfer, units are updated for affected accounts (sender/recipient).
- No direct user custody of target shares: wrapper is sole owner of target vault shares corresponding to wrapper supply.

## 6) ERC4626 integration points
- afterDeposit(assets, shares): approve target vault and deposit assets to the target for the wrapper; record no extra state beyond balances; update units for the receiver.
- beforeWithdraw(assets, shares): redeem/withdraw from the target vault sufficient underlying for the wrapper to fulfill the withdrawal; update units for the owner.
- _afterTokenTransfer(from, to, amount): on wrapper share transfers, recompute and update units for from and to (connect/disconnect to pool if needed).

## 7) Superfluid pool wiring
- Create the pool in the constructor with PoolConfig{ transferabilityForUnitsOwner: false, distributionFromAnyAddress: true }.
- The wrapper is the pool admin (only the wrapper updates member units).
- Member lifecycle: connect on first positive units; disconnect optional. Units govern the share regardless of connection status; consider connecting lazily and relying on claimAll.

## 8) Public methods (external surface)
- deposit(uint256 assets, address receiver)
- mint(uint256 shares, address receiver)
- withdraw(uint256 assets, address receiver, address owner)
- redeem(uint256 shares, address receiver, address owner)
- Standard ERC4626 views: asset(), totalAssets(), convertToAssets(), convertToShares(), previewDeposit/Withdraw/Mint/Redeem, maxDeposit/Withdraw/Mint/Redeem.
- Pool views: pool(), unitsOf(address)

## 9) Units update strategy
- On mint/deposit: compute new units = convertToAssets(balanceOf(receiver)) and pool.updateMemberUnits(receiver, uint128(newUnits)).
- On burn/withdraw: same for owner.
- On transfer: recompute for from and to. If balance is zero, units become zero.
- Casting and rounding: floor on convert/preview; cast to uint128; add guardrails against overflow (practical ranges only).

## 10) Multi-vault aggregation (optional)
- Preferred for clarity: one wrapper and pool per target vault.
- If aggregation is desired: maintain a set of target vaults; store per-vault positions; units = sum(convertToAssets_per_vault(balance_per_vault)). This adds complexity and must respect gas limits.

## 11) Distribution policy
- Continuous: superToken.distributeFlow(pool, flowRate), where flowRatePerUnit = floor(totalFlowRate / totalUnits). Design flows to avoid flowRatePerUnit=0.
- Periodic: superToken.distribute(pool, amount) and/or claimAll; remainders from integer division accumulate until claim.
- Reconcile-before-distribute (optional guard): ensure latest balances are reflected by updating units for addresses with recent balance changes.

## 12) Security considerations
- Reentrancy: guard deposit/withdraw paths and pool updates; use checks-effects-interactions.
- Approvals: use safe approve patterns (forceApprove) to the target vault.
- Slippage: respect preview* and max*; handle zero/edge amounts; ensure sufficient liquidity for withdraw.
- Access control: only wrapper updates units; no user ability to update units directly.

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
