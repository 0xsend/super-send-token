# Wrapper

## Flow (scripts/wrapper/create.ts)
- Resolution order: (1) deployments/wrapper.{chainId}.json if present
  and valid, (2) SuperTokenFactory.getCanonicalERC20Wrapper(sendV1),
  (3) if CREATE_WRAPPER=true, create via SuperTokenFactory
  (simulate→write with viem). Validate by checking bytecode and that
  ISuperToken.getUnderlyingToken() equals configured SEND v1. Persist
  deployments/wrapper.{chainId}.json.

## Related commands
- Wrapper discovery/creation
  - Local anvil: CREATE_WRAPPER=true \
    bunx hardhat run scripts/wrapper/create.ts --network anvil
  - Base mainnet: bunx hardhat run scripts/wrapper/create.ts --network base
  - Base Sepolia: bunx hardhat run scripts/wrapper/create.ts --network sepolia
- Local orchestration helper
  - ./bin/anvil-deploy (expects Anvil at 127.0.0.1:8546; funds
    EOA_DEPLOYER, toggles automine/interval, runs wrapper creation)

## Commit history (base → top)

## Add SuperToken wrapper plan
Why:
Document the intended wrapper strategy and constraints to
align contributors and future work.

Test plan:
- Open PLAN.md and verify plan sections are present.


## Add wrapper create/attach script
Why:
Automate discovery or creation of SENDx via SuperTokenFactory
use, mirroring official ABIs with viem+Hardhat.

Test plan:
- CREATE_WRAPPER=true bunx hardhat run scripts/wrapper/create.ts --network anvil
- Verify deployments/wrapper.*.json updated.


## Validate wrapper metadata and upgrade/downgrade; optional CFA smoke
Why:
Ensure the SENDx wrapper is correct and usable. Verify name,
symbol, and decimals; exercise upgrade/downgrade round‑trip
(gated by SEND_HOLDER). Optionally smoke CFA lifecycle to
confirm Host/CFA calls are reachable without committing to
long‑lived flows.

Test plan:
- bunx hardhat test test/wrapper.ts
- Optional: RUN_CFA_SMOKE=true bunx hardhat test test/wrapper.ts


## Wire anvil-deploy to wrapper script; set signer
Why:
Make local orchestration run wrapper creation with the anvil
signer sourced from EOA_DEPLOYER for consistency.

Test plan:
- ./bin/anvil-deploy on a Base fork.
- Observe wrapper create/attach steps succeed.


## Add UNDERLYING_ADDRESS override for wrapper
Why:
Allow overriding the underlying token address while keeping
canonical/create validation flow.

Test plan:
- Run scripts/wrapper/create.ts with override.
- Verify underlying matches configured address.


## Update wrapper cache for anvil (845337)
Why:
Keep local wrapper address cache in sync with current fork.

Test plan:
- Inspect deployments/wrapper.845337.json.


## Split docs into feature docs; remove stack-plan

Why:
Move documentation from docs/stack-plan.md into per-feature docs to
align docs with features and avoid duplication. This file now carries the
wrapper commit history.

Test plan:
- Open docs/wrapper.md and verify this entry appears at the end of the
  commit history.
- Confirm docs/stack-plan.md has been removed and README links to feature
  docs.


