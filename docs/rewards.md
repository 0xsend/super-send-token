# Rewards

## Path and lifecycle
- Contract: contracts/rewards/RewardsManager.sol (minimal
  AccessControl). It sums a user’s assets across ERC‑4626 vaults of
  the same underlying (e.g., USDC) and mirrors that total to Pool
  units via updateMemberUnits.
- Lifecycle: The constructor requires an existing SuperToken (SENDx)
  and creates the Superfluid Pool using SuperTokenV1Library with the
  contract as admin.
- Deploy script (scripts/rewards/deploy.ts): resolves SendEarnFactory
  and a representative share token (or uses env), derives the vault’s
  underlying via IERC4626.asset(), deploys RewardsManager (creates the
  pool), and persists the pool address to
  deployments/rewards.{chainId}.json.
- Cross-repo coupling: For share token discovery, the deploy script can
  read a Foundry broadcast file from the sibling send-earn-contracts
  repo; prefer SHARE_TOKEN_ADDRESS or SEND_EARN_BROADCAST_DIR to avoid
  machine-specific paths.

## Current state
- Units reflect ERC‑4626 assets (uint128), syncing pool
  units to users’ on-chain balances. Admin is minimal; sync calls are
  safe/idempotent.
- RewardsManager requires an existing SENDx and creates the Pool in its
  constructor. Tests cover wrapper metadata and rewards behaviors (some
  gated by env flags). Local helpers exist to fund holders on forks.
- Persistence and idempotency: deployments/*.json caches wrapper and
  rewards addresses for reuse.

## Related commands
- Deploy RewardsManager (requires existing SENDx; constructor creates the
  Superfluid Pool)
  - bunx hardhat run scripts/rewards/deploy.ts --network anvil|base|sepolia
- Fund a holder with vault shares on a fork (for rewards tests)
  - VAULT_ADDRESS=0x... SHARE_HOLDER=0x... AMOUNT_ASSETS=... \
    bunx hardhat run scripts/rewards/fundHolder.ts --network anvil
- Streaming checks run on the default hardhat Base fork. Ensure BASE_RPC is reachable (or set BASE_FORK_BLOCK for stability).

## Commit history (base → top)

## 07e36a2 Add RewardsManager plan doc
Why:
Capture scope and strategy for RewardsManager to align on
pool creation and unit sync behavior.

Test plan:
- Open docs/rewards/PLAN.md; verify content.

Commit: 07e36a2

## 0fc4d93 Add RewardsManager for pool units sync
Why:
Create minimal manager to mirror ERC-4626 asset balances to
Superfluid pool units.

Test plan:
- bunx hardhat compile
- bunx hardhat test test/rewards.manager.test.ts

Commit: 0fc4d93

## 2bf288a script: rewards deploy (resolve sendx/share, require pool addr)
Commit: 2bf288a

## 86acc12 Add rewards deploy script and pool requirements
Why:
Automate deployment around SENDx/Share discovery and require
pool address persistence.

Test plan:
- bunx hardhat run scripts/rewards/deploy.ts --network anvil
- Verify deployments/rewards.*.json written.

Commit: 86acc12

## 472d60d Require existing SENDx in RewardsManager constructor
Why:
Decouple wrapper creation from rewards by requiring an existing
ISuperToken (SENDx) to be passed into the RewardsManager
constructor. This simplifies lifecycle, avoids implicit wrapper
creation, and clarifies responsibilities between features.

Test plan:
- bunx hardhat compile
- bunx hardhat test test/rewards.manager.test.ts
- bunx hardhat run scripts/rewards/deploy.ts --network anvil
  (SENDx resolved; pool is created; deployments updated)

Commit: 472d60d

## 7509f03 Require existing SENDx and persist in deployments
Why:
Ensure deployments include SENDx and pass it into manager for
consistent wiring.

Test plan:
- Run deploy script on anvil.
- Check deployments JSON includes sendx.

Commit: 7509f03

## 2a9d0b3 Test passing SENDx to RewardsManager
Why:
Ensure tests reuse wrapper resolution patterns and pass SENDx
to the manager.

Test plan:
- bunx hardhat test test/rewards.normalize.test.ts

Commit: 2a9d0b3

## 3d0fc4f Update docs: manager requires existing SuperToken
Why:
Reflect that the RewardsManager constructor requires an
existing SENDx; update README and WARP accordingly.

Test plan:
- Render README and WARP; verify updated instructions.

Commit: 3d0fc4f

## 9cc1468 Update Ignition module and params to use SENDx
Why:
Bring Ignition deployment inputs in line with the new manager
constructor contract.

Test plan:
- Run ignition deploy with SENDx parameter set.

Commit: 9cc1468

## 2567ed4 Cache deployments and add artifacts for manager
Why:
Speed local workflows by caching deployments and providing
compiled artifacts for tests/scripts.

Test plan:
- Verify deployments written.
- bun run test completes.

Commit: 2567ed4

## 32ac7ed Add fundHolder helper to deposit and mint shares
Why:
Enable local fork testing by funding a holder via scripted
deposits and share mints.

Test plan:
- bunx hardhat run scripts/rewards/fundHolder.ts --network anvil

Commit: 32ac7ed

## a1f1115 Add mocks: ERC20, ERC4626 vault, SendEarnFactory
Why:
Provide minimal mocks to enable self-contained tests.

Test plan:
- bunx hardhat compile
- bunx hardhat test (mocks-related tests pass)

Commit: a1f1115

## 581b600 Enable streaming and wrapper upgrade in tests
Why:
Now that approve exists on MockERC20, enable streaming tests
and local wrapper upgrade flows.

Test plan:
- bunx hardhat test test/rewards.streaming.test.ts
- bunx hardhat test test/wrapper.ts

Commit: 581b600

## 0bd7274 Split docs into feature docs; remove stack-plan

Why:
Move documentation from docs/stack-plan.md into per-feature docs to
align docs with features and avoid duplication. This file now carries the
rewards commit history.

Test plan:
- Open docs/rewards.md and verify this entry appears at the end of the
  commit history.
- Confirm docs/stack-plan.md has been removed and README links to feature
  docs.

Commit: 0bd7274

