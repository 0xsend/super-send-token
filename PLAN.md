# Super Send SuperToken Wrapper – Plan (PR1)

Scope and boundaries
• This repo is for a new Superfluid-based SuperToken wrapper around the already-deployed SEND v1.
• Do not include or modify the lockbox or the v1 token here—they live in a separate repo: ~/Documents/Send/send-token-upgrade.
• The wrapper is backend-only; end users never hold or interact with it. No convenience/combined functions.

External dependencies (addresses)
• SEND v1 (underlying)
  • Base mainnet (8453): 0xEab49138BA2Ea6dd776220fE26b7b8E446638956
  • Base Sepolia (84532): 0xBbB542c66a7DD7BA6893C9630B30358D610FF3ee
  • Local Base mainnet (845337): 0xEab49138BA2Ea6dd776220fE26b7b8E446638956
• Superfluid core
  • Base mainnet:
    • Resolver: 0x6a214c324553F96F04eFBDd66908685525Da0E0d
    • Host: 0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74
    • CFAv1: 0x19ba78B9cDB05A877718841c574325fdB53601bb
    • SuperTokenFactory: 0xe20B9a38E0c96F61d1bA6b42a61512D56Fea1Eb3
  • Base Sepolia:
    • Resolver: 0x21d4E9fbB9DB742E6ef4f29d189a7C18B0b59136
    • Host: 0x109412E3C84f0539b43d39dB691B08c90f58dC7c
    • CFAv1: 0x6836F23d6171D74Ef62FcF776655aBcD2bcd62Ef
    • SuperTokenFactory: 0x7447E94Dfe3d804a9f46Bf12838d467c912C8F6C

Operational context
• Tests and deployments treat SEND v1 as an external dependency (attach by address; do not deploy it).
• Keep env vars: EOA_DEPLOYER, ETHERSCAN_API_KEY. For forked tests, impersonate as needed.
• Local dev: bun run test (Hardhat tests on Base fork); ./bin/anvil-deploy to run wrapper deploy flow locally.

Defaults (can be overridden later)
• Wrapper name/symbol: “Super Send” / “SENDx”
• Underlying decimals: 18
• Upgradability: SEMI_UPGRADABLE
• Owner: EOA_DEPLOYER (script signer only; wrapper is created via SuperTokenFactory)
• Networks in scope: Base mainnet (8453), Base Sepolia (84532), local Base fork (845337)

Planned PR stack
• PR1 (this PR): PLAN.md only (no code changes)
• PR2 (cleanup): Remove/ignore all legacy migration contracts/tests (SendToken, Lockbox, old Ignition module), repoint Tilt to wrapper-only
• PR3 (config + deps): Add Superfluid per-network config and ABIs; deployments/ scaffolding; README update
• PR4 (script): Viem-based wrapper create/attach script calling SuperTokenFactory.createERC20Wrapper and persisting deployments/wrapper.{chainId}.json
• PR5 (tests): Base-fork tests — metadata + upgrade/downgrade round-trip (gated by SEND_HOLDER), optional CFA smoke (gated by RUN_CFA_SMOKE)
• PR6 (ops): Repurpose bin/anvil-deploy to wrapper-only flow and update Tiltfile

Acceptance criteria
• No lockbox/v1 contracts or tests remain in this repo
• Superfluid ABIs installed; network addresses configured per chain
• Wrapper create/attach script works on Base fork and persists to deployments/
• Tests pass on fork:
  • Metadata test always runs
  • Upgrade/downgrade test passes when SEND_HOLDER is provided; otherwise skipped with a clear message
  • Optional CFA smoke test passes when RUN_CFA_SMOKE=true; otherwise skipped
• README documents backend-only wrapper flow and Graphite workflow

References (Rule 3: mirror official examples; no custom Solidity)
• SuperTokenFactory: docs and contract
  • https://docs.superfluid.finance/superfluid/protocol-developers/supertokens/supertokenfactory
  • https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/superfluid/SuperTokenFactory.sol
• ISuperToken (upgrade/downgrade/metadata)
  • https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/interfaces/superfluid/ISuperToken.sol
• CFAv1 docs and interface
  • https://docs.superfluid.finance/superfluid/developers/constant-flow-agreement-cfa
  • https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol
• Hardhat + Viem
  • https://github.com/NomicFoundation/hardhat-viem
• Ignition external call pattern (optional)
  • https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-ignition

