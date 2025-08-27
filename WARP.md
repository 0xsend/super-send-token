# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

1) Overview
- This repo orchestrates a Superfluid SuperToken wrapper (SENDx) around the existing SEND v1 token, for backend-only flows. No custom wrapper Solidity exists here; wrapper creation uses Superfluid’s official contracts/ABIs and viem via Hardhat.
- SEND v1 and Superfluid core addresses for Base mainnet and Base Sepolia are defined in config/superfluid.ts and README.md.

2) Tooling and environment
- Prereqs: Bun + Node, Hardhat, Anvil (local Base fork), Foundry’s cast (used by bin/anvil-deploy), and .env support (direnv optional via .envrc).
- Required env vars: EOA_DEPLOYER, ETHERSCAN_API_KEY. Optional env flags used by scripts/tests: CREATE_WRAPPER, SEND_HOLDER, RUN_CFA_SMOKE, SHARE_TOKEN_ADDRESS, SEND_EARN_BROADCAST_DIR, ANVIL_BLOCK_TIME.
- Networks (see hardhat.config.ts): hardhat (forking Base mainnet at a fixed block), anvil (http://127.0.0.1:8546, chainId 845337), base (8453), sepolia (84532). Etherscan settings are included for base and sepolia.

3) Common commands (supported by this repo)
- Install dependencies
  - bun install
  - npm ci also works (package-lock.json present), but examples assume Bun.
- Compile
  - bunx hardhat compile
- Run all tests
  - bun run test  (package.json maps to "hardhat test")
  - Equivalent: bunx hardhat test
- Run a single test file
  - bunx hardhat test test/wrapper.ts
  - bunx hardhat test test/rewards.manager.test.ts
- Optional multi-vault aggregation test
  - VAULT_ADDRESSES=0xVault1,0xVault2 [VAULT_HOLDERS=0xHolder1,0xHolder2] bunx hardhat test --network anvil
    (SHARE_TOKEN_ADDRESSES is accepted for backward compatibility.)
- Filter tests by name (Mocha grep)
  - bunx hardhat test --grep "upgrade and downgrade"
- Create or discover SENDx wrapper on a network
  - Local anvil (requires Anvil at 127.0.0.1:8546):
    - CREATE_WRAPPER=true bunx hardhat run scripts/wrapper/create.ts --network anvil
  - Base mainnet:
    - bunx hardhat run scripts/wrapper/create.ts --network base
  - Base Sepolia:
    - bunx hardhat run scripts/wrapper/create.ts --network sepolia
- Local deploy orchestration helper
  - ./bin/anvil-deploy
  Notes: Expects Anvil at http://127.0.0.1:8546. Funds EOA_DEPLOYER on the fork, sets CREATE_WRAPPER=true, runs wrapper creation, and toggles mining settings (uses Foundry cast + Bun + Hardhat).
- Deploy RewardsManager (after compile). The contract requires an existing SuperToken (SENDx) and creates the Superfluid Pool in its constructor:
  - bunx hardhat run scripts/rewards/deploy.ts --network anvil
  - bunx hardhat run scripts/rewards/deploy.ts --network base
  - bunx hardhat run scripts/rewards/deploy.ts --network sepolia

4) Big-picture architecture
- Network/config layer
  - config/superfluid.ts centralizes per-network config: SEND v1, Superfluid core (resolver, host, CFAv1), SuperTokenFactory, and wrapper metadata (name/symbol/decimals). Consumed by scripts and tests.
- Wrapper flow (scripts/wrapper/create.ts)
  - Resolution order: (1) deployments/wrapper.{chainId}.json if present and valid, (2) SuperTokenFactory.getCanonicalERC20Wrapper(sendV1), (3) if CREATE_WRAPPER=true, create via SuperTokenFactory.createERC20Wrapper (viem simulate->write). 
  - Validates a candidate wrapper by checking bytecode presence and verifying ISuperToken.getUnderlyingToken() equals configured sendV1.
  - Persists deployments/wrapper.{chainId}.json with underlying, createdAt, factory, chainId.
- Local orchestration (bin/anvil-deploy)
  - Uses Foundry cast RPC calls to set automine, optionally funds EOA_DEPLOYER, sets CREATE_WRAPPER=true, runs wrapper creation on --network anvil, then switches to interval mining (ANVIL_BLOCK_TIME).
- Tests
  - test/wrapper.ts resolves wrapper via deployments cache or canonical mapping; can create on-demand when CREATE_WRAPPER=true. It validates metadata/underlying; upgrade/downgrade round-trip is gated by SEND_HOLDER; CFA smoke checks gated by RUN_CFA_SMOKE ensure host/CFA calls are reachable without committing to flow lifecycle state.
  - test/rewards.manager.test.ts resolves SENDx and a representative ERC-4626 vault (or ASSET_ADDRESS), deploys RewardsManager (which creates the pool), and calls syncVault(holder) when SHARE_TOKEN_ADDRESS and SHARE_HOLDER are provided. Use scripts/rewards/fundHolder.ts on local forks to ensure the holder has non-zero shares.
- Rewards path
- Contract: contracts/rewards/RewardsManager.sol (minimal AccessControl) sums a user’s assets across multiple ERC-4626 vaults sharing the same underlying (e.g., USDC) and mirrors that total to Superfluid Pool units via updateMemberUnits. It creates the Superfluid pool in its constructor using SuperTokenV1Library with itself as admin.
- Deployment: scripts/rewards/deploy.ts resolves SendEarnFactory and a representative share token (or uses env), derives the underlying asset via IERC4626.asset(), deploys RewardsManager (which creates the pool), then queries and persists the pool address into deployments/rewards.{chainId}.json.
- Cross-repo coupling
  - For share token discovery, scripts/rewards/deploy.ts currently points to a broadcast file produced by the sibling repo send-earn-contracts. Prefer setting SHARE_TOKEN_ADDRESS or overriding the directory via SEND_EARN_BROADCAST_DIR (supported by the test) to avoid machine-specific absolute paths.
- Persistence and idempotency
  - deployments/*.json caches wrapper and rewards addresses for reuse and to short-circuit subsequent runs.

5) Intentionally absent
- Lint/format: No ESLint/Prettier config or lint scripts are present; no lint commands are included here.
- Build: There is no separate build step beyond Hardhat compile; TypeScript runs via Hardhat/ts-node under Bun. No package build script exists.

6) CI guidance (optional)
- Prefer running the suite on an anvil fork for wrapper/pool creation determinism:
  - Start anvil in CI (Foundry): anvil --fork-url $BASE_RPC --port 8546 --chain-id 845337
  - Export envs for any gated tests (e.g., SHARE_TOKEN_ADDRESS, SHARE_HOLDER).
  - Run: bunx hardhat test --network anvil
- Gate network-dependent tests via envs so CI can run a minimal subset without secrets (e.g., run wrapper metadata only).

7) References used by this repo (authoritative)
- SuperTokenFactory: https://docs.superfluid.finance/superfluid/protocol-developers/supertokens/supertokenfactory
- ISuperToken: https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/interfaces/superfluid/ISuperToken.sol
- CFAv1: https://docs.superfluid.finance/superfluid/developers/constant-flow-agreement-cfa
- Hardhat + viem: https://github.com/NomicFoundation/hardhat-viem

