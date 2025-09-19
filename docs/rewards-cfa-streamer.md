# CFA Rewards Streamer (no pool units)

Status: Proposal (docs-only PR)

Goals
- Replace pool+units distribution with per-user CFA flows in SENDx.
- Aggregate balances across SendEarn ERC‑4626 vaults (same underlying asset) but avoid storing per‑vault shares; store assets only.
- Update a user’s flow on every deposit/withdraw the user performs (keeperless). If flowRate becomes zero, delete the flow.
- Enforce vault acceptance: only SendEarn vaults (factory.isSendEarn) with uniform IERC4626.asset() == asset.

Key primitives
- SuperTokenV1Library.flow(ISuperToken token, address receiver, int96 flowRate)
  - Create if no flow and flowRate>0; update if exists and >0; delete if exists and =0; no‑op if unchanged.
  - Requires the contract to hold enough SENDx (buffer is reserved on creation; buffer is returned on delete if solvent).
- ERC4626
  - deposit/withdraw to/from SendEarn vaults at action boundaries; no need to store shares per user when we store assets credits per vault.

Data model
- assetsByVault[user][vault] -> uint256 assets credit for that user in that vault
- totalAssetsByUser[user] -> Σ assetsByVault[user][*]
- No user share balances are stored; the contract holds the actual vault shares backing the aggregate.

Flow rate policy (3% annual in SENDx)
- Define a per‑second factor from the annual rate:
  - perSec = 0.03 / secondsPerYear
- Convert the user’s aggregated assets into SENDx using an oracle (asset → SENDx):
  - sendxPerAsset = oracle.price(asset, SENDx)  // e.g., as a fixed‑point ratio
  - userValueSENDx = totalAssetsByUser[user] * sendxPerAsset
- flowRate(user) = floor(userValueSENDx * perSec)
  - If rate == 0: delete the flow via token.flow(user, 0)
  - Else: token.flow(user, rate)

Viability guard
- Only stream while floor(totalFlowRate / activeUserCount) is operationally sane OR, simpler: while each user’s flowRate ≥ 1 wei/sec. Otherwise, fallback to periodic distributions or pause until TVL/budget is higher.

Public surface (aggregated, non‑transferable)
- depositAssets(vault, assets)
  - require isSendEarn(vault) and IERC4626(vault).asset()==asset
  - transferFrom user → this, approve+deposit into vault for this contract
  - assetsByVault[user][vault] += assets; totalAssetsByUser[user] += assets
  - recompute and set CFA flow with token.flow(user, newRate)
- withdrawAssets(vault, assets, receiver)
  - compute sharesNeeded=previewWithdraw(assets); ensure contract holds enough shares; ensure assetsByVault[user][vault] ≥ assets
  - assetsByVault[user][vault] -= assets; totalAssetsByUser[user] -= assets
  - vault.withdraw(assets, receiver, this)
  - recompute and set CFA flow
- fund(token=SENDx, amount)
  - Admin or anyone can fund the contract with SENDx to ensure buffer/stream solvency

Security and validation
- Vault gating (factory.isSendEarn) and uniform asset invariant are mandatory.
- Reentrancy guard on deposit/withdraw/flow updates.
- Safe approvals to vault (forceApprove reset to 0 then set to amount).
- Flow buffer: document that the contract must be pre‑funded with SENDx to start or raise flows.

Observability
- Events: FlowSet(user, oldRate, newRate); Deposited(user, vault, assets, newRate); Withdrawn(user, vault, assets, newRate).
- Views: totalAssetsByUser(user); assetsByVault(user,vault); flowRateOf(user) (read from CFA if desired).

Open items (follow‑ups)
- Oracle wiring: asset→SENDx conversion; admin‑settable oracle; circuit breaker if price stale.
- Admin controls: setAnnualRateBps (default 300 bps), setSecondsPerYear, setOracle.
- Batch maintenance helpers: updateFlows(start,count) to re‑compute for ranges if needed.
- Fallback periodic distribution helper (optional) for low‑rate scenarios.

References
- SuperTokenV1Library flow helper (official): https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol
- CFA docs: https://docs.superfluid.finance/superfluid/developers/constant-flow-agreement-cfa
- SendEarnFactory gating (in repo): send-earn-contracts/src/SendEarnFactory.sol isSendEarn
