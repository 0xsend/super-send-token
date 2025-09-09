# Platform and environment

## Overview and goals
- This repository orchestrates a Superfluid-based SuperToken wrapper
  (SENDx) around the existing SEND v1 token. No lockbox/v1 token
  contracts live here; those remain in the send-token-upgrade repo.
- The wrapper is for backend-only flows; end users never directly hold
  it.
- The rewards path mirrors ERC-4626 vault assets to Superfluid Pool
  units so distribution reflects users’ on-chain balances.

## Tooling and environment
- Prereqs: Bun + Node, Hardhat, Anvil (local Base fork), Foundry’s cast,
  and .env support (direnv optional via .envrc).
- Required env vars: EOA_DEPLOYER, ETHERSCAN_API_KEY.
- Optional env/test flags: CREATE_WRAPPER, SEND_HOLDER, RUN_CFA_SMOKE,
  SHARE_TOKEN_ADDRESS, SEND_EARN_BROADCAST_DIR, ANVIL_BLOCK_TIME.
- Networks (see hardhat.config.ts):
  - hardhat (Base mainnet fork), anvil (http://127.0.0.1:8546, chainId
    845337), base (8453), sepolia (84532). Etherscan settings are
    included for base and sepolia.
- For warp.dev-specific guidance and command recipes, see WARP.md.

## Networks and addresses
- Canonical network addresses (SEND v1, Superfluid core, SuperToken
  factory) are defined in config/superfluid.ts and summarized in the
  README.
- Example (from README at time of consolidation):
  - SEND v1 (underlying)
    - Base mainnet (8453): 0xEab49138BA2Ea6dd776220fE26b7b8E446638956
    - Base Sepolia (84532): 0xBbB542c66a7DD7BA6893C9630B30358D610FF3ee
    - Local Base mainnet (845337): 0xEab49138BA2Ea6dd776220fE26b7b8E446638956
  - Superfluid core (examples; see config/superfluid.ts for authoritative
    values): Resolver, Host, CFAv1, SuperTokenFactory per network.

## Commands and workflows (general)
- Install deps: bun install
- Compile: bunx hardhat compile
- Run all tests (Base fork recommended): bun run test
- Filter tests by name (Mocha grep):
  - bunx hardhat test --grep "upgrade and downgrade"

## SuperTokenV1Library notes
- We follow Superfluid’s official, token-centric library patterns for
  pool creation and distribution primitives (e.g., createPool,
  connectPool, isMemberConnected, distribute, distributeFlow).
- Authoritative references:
  - SuperTokenFactory:
    https://docs.superfluid.finance/superfluid/protocol-developers/supertokens/supertokenfactory
  - ISuperToken (interfaces):
    https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/interfaces/superfluid/ISuperToken.sol
  - CFAv1:
    https://docs.superfluid.finance/superfluid/developers/constant-flow-agreement-cfa
  - SuperTokenV1Library (source):
    https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol

## CI guidance (optional)
- Prefer running on an anvil fork for determinism:
  - anvil --fork-url $BASE_RPC --port 8546 --chain-id 845337
  - Export envs for gated tests (e.g., SHARE_TOKEN_ADDRESS, SHARE_HOLDER)
  - bunx hardhat test --network anvil
- Gate network-dependent tests via envs so CI can run a minimal subset.

## References
- Hardhat + viem: https://github.com/NomicFoundation/hardhat-viem
- Ignition:
  https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-ignition
- Superfluid networks reference:
  https://docs.superfluid.finance/superfluid/developers/networks

## Commit history (base → top)

## 2ce849f Initialize README for SuperToken wrapper

Why:
Introduce initial README to describe the SuperToken wrapper
and repository scope so contributors have context.

Test plan:
- Open README.md and verify content renders.

Commit: 2ce849f

## af49ed5 Scaffold project from send-token-upgrade

Why:
Bootstrap repository structure using the known baseline to
accelerate initial setup while keeping consistent tooling.

Test plan:
- List files; key scaffolding files exist.
- bunx hardhat compile succeeds.

Commit: af49ed5

## 2334262 Rename package name

Why:
Ensure the package name matches the repository purpose and
avoids conflicts in local toolchains.

Test plan:
- Inspect package.json name field.
- bun install completes without warnings.

Commit: 2334262

## 8f87619 Remove legacy lockbox code; rename Tilt resource

Why:
Drop vestigial lockbox/v1 contracts not used here and keep
dev tooling consistent by renaming Tilt resources.

Test plan:
- Confirm removed contracts no longer exist.
- Tilt runs with updated resource names.

Commit: 8f87619

## 4440c4a Bootstrap Superfluid config and deployments

Why:
Establish the network configuration and deterministic deploy
caches so wrapper discovery/creation is reliable and repeatable.
Centralize Superfluid core (resolver, host, CFAv1, factory) and
SEND v1 addresses in config/superfluid.ts. Add a deployments
scaffold (deployments/wrapper.*.json) for idempotent runs and
future scripts.

Repo hygiene:
- Update .gitignore to track docs/ and generalize dotenv ignores
  (ignore .env*; keep .env.sample tracked).

Test plan:
- bunx hardhat compile
- bunx hardhat run scripts/wrapper/create.ts --network anvil
  (writes/reads deployments/wrapper.845337.json)
- bunx hardhat run scripts/wrapper/create.ts --network base|sepolia
  (read-only discovery path)

Commit: 4440c4a

## 0d00a52 Add Superfluid ABIs helper

Why:
Centralize ABI references used by scripts to avoid drift and
improve maintainability.

Test plan:
- Inspect scripts/abis/superfluid.ts.
- Run wrapper/rewards scripts without ABI errors.

Commit: 0d00a52

## 9f22c5a Add CFAv1Forwarder field (optional)

Why:
Expose forwarder address for optional streaming helpers and
integration tests.

Test plan:
- Inspect config/superfluid.ts includes forwarder.

Commit: 9f22c5a

## 3e706dd Add test/type dependencies and refresh bun.lock

Why:
Provide required types and keep lockfile up to date to avoid
install issues.

Test plan:
- bun install succeeds.
- Type checks pass.

Commit: 3e706dd

## f98498d Ensure hardfork=cancun on hardhat network

Why:
Avoid mismatches in EVM behavior across local networks.

Test plan:
- Inspect hardhat.config.ts for hardfork=cancun.
- bunx hardhat compile works.

Commit: f98498d

## f81d703 Align viem calls and env discovery in tests

Why:
Reduce flakiness and ensure tests resolve env/config in a
consistent way.

Test plan:
- bunx hardhat test test/rewards.manager.test.ts
- bunx hardhat test test/wrapper.ts

Commit: f81d703

## bfc0b68 Add SuperTokenV1Library notes and update docs

Why:
Record library usage patterns and refine project planning
documents for clarity.

Test plan:
- Open SuperTokenV1Library.md and PLAN.md.

Commit: bfc0b68

## 0bd7274 Split docs into feature docs; remove stack-plan

Why:
Move documentation from docs/stack-plan.md into per-feature docs to
align docs with features and avoid duplication. This file now carries the
platform/infra commit history.

Test plan:
- Open docs/platform.md and verify this entry appears at the end of the
  commit history.
- Confirm docs/stack-plan.md has been removed and README links to feature
  docs.

Commit: 0bd7274

