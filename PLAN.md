# Super Send – Current Plan and Architecture

Overview
- This repo orchestrates a Superfluid-based SuperToken wrapper (SENDx) around existing SEND v1 and implements a rewards path that mirrors ERC-4626 vault assets to Superfluid pool units.
- No lockbox/v1 token code lives here (send-token-upgrade repo owns those). End users never hold the wrapper; this is backend-only.

Architecture
- Wrapper
  - Created or discovered via scripts/wrapper/create.ts using SuperTokenFactory.
  - Persisted to deployments/wrapper.{chainId}.json.
- Rewards
- Contract: contracts/rewards/RewardsManager.sol
  - Purpose: aggregate a user’s assets across multiple ERC-4626 vaults (same underlying, e.g., USDC) and update Superfluid pool units to match.
  - Wrapper + Pool lifecycle: the constructor first resolves or creates the SENDx wrapper via SuperTokenFactory (if canonical wrapper is absent), then creates the Superfluid Pool (admin = this contract) via GDA. No external wrapper/pool addresses are needed.
  - AccessControl: minimal — DEFAULT_ADMIN_ROLE is set to the provided admin; units are set purely based on on-chain vault balances (no custom operator roles).

Tooling and scripts
- Wrapper discovery/creation
  - CREATE_WRAPPER=true bunx hardhat run scripts/wrapper/create.ts --network anvil
- Rewards deploy
  - bunx hardhat run scripts/rewards/deploy.ts --network <net>
- Resolves: SEND v1 and SuperTokenFactory, SendEarnFactory, underlying asset (via vault IERC4626.asset()), deploys RewardsManager(sendV1, superTokenFactory, sendEarnFactory, asset, admin, minAssets), then reads pool() for deployments JSON.
- Holder funding helper (local/fork testing)
  - SHARE_TOKEN_ADDRESS=0xVault SHARE_HOLDER=0xHolder AMOUNT_ASSETS=1000000 \
    bunx hardhat run scripts/rewards/fundHolder.ts --network anvil

Testing strategy
- test/rewards.manager.test.ts
  - Requires a SENDx wrapper and a representative ERC-4626 vault + holder.
  - Env-gated: SHARE_TOKEN_ADDRESS, SHARE_HOLDER (optional ASSET_ADDRESS).
  - Deploys RewardsManager (which creates pool) and calls syncVault.
- test/wrapper.ts
  - Wrapper metadata, upgrade/downgrade round-trip (gated by SEND_HOLDER), optional CFA smoke (gated by RUN_CFA_SMOKE).
- Recommendation: use the anvil network for local runs (wrapper creation on the hardhat fork can fail due to provider hardfork-history constraints).

Environments
- Required: EOA_DEPLOYER, ETHERSCAN_API_KEY
- Optional (tests/scripts):
  - CREATE_WRAPPER=true — allow wrapper creation
  - SHARE_TOKEN_ADDRESS, SHARE_HOLDER — rewards test inputs
  - ASSET_ADDRESS — override vault asset discovery
  - SEND_HOLDER — wrapper upgrade/downgrade test
  - RUN_CFA_SMOKE=true — optional CFA smoke test
  - SEND_EARN_BROADCAST_DIR — alternate path to Foundry broadcasts for vault discovery

Current status
- RewardsManager creates and administers the pool in its constructor.
- scripts/rewards/deploy.ts deploys with constructor args (sendV1, superTokenFactory, sendEarnFactory, asset, admin, minAssets) and persists the created pool.
- README and WARP docs reflect the in-constructor pool creation and the helper script for funding a holder.
- Hardhat fork block pin removed to avoid EDR/viem hardfork-history issues for wrapper creation; anvil is recommended for wrapper work.

Next steps
- Optional: add a multi-vault test using batchSyncVaults([...], who) with SHARE_TOKEN_ADDRESSES to validate aggregation over multiple vaults.
- Optional: wire CI runs on anvil for deterministic wrapper creation, plus targeted Base/Sepolia smoke runs.
- Optional: small admin helpers (distributor flows) if operationally needed later — currently out of scope.

References
- SuperTokenFactory
  - https://docs.superfluid.finance/superfluid/protocol-developers/supertokens/supertokenfactory
- ISuperToken
  - https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/interfaces/superfluid/ISuperToken.sol
- GDA / Pools
  - https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/interfaces/agreements/gdav1/IGeneralDistributionAgreementV1.sol
- CFAv1
  - https://docs.superfluid.finance/superfluid/developers/constant-flow-agreement-cfa
- Hardhat + Viem
  - https://github.com/NomicFoundation/hardhat-viem
- Ignition
  - https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-ignition

