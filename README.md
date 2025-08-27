# Super Send – SuperToken Wrapper (backend-only)

This repository orchestrates a Superfluid-based SuperToken wrapper around the existing SEND v1 token. No lockbox/v1 token contracts live here; they remain in `~/Documents/Send/send-token-upgrade`. End users never hold or interact with the wrapper; it is for backend flows only.

Addresses (per network)
- SEND v1 (underlying)
  - Base mainnet (8453): 0xEab49138BA2Ea6dd776220fE26b7b8E446638956
  - Base Sepolia (84532): 0xBbB542c66a7DD7BA6893C9630B30358D610FF3ee
  - Local Base mainnet (845337): 0xEab49138BA2Ea6dd776220fE26b7b8E446638956
- Superfluid core
  - Base mainnet: Resolver 0x6a214c324553F96F04eFBDd66908685525Da0E0d, Host 0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74, CFAv1 0x19ba78B9cDB05A877718841c574325fdB53601bb, SuperTokenFactory 0xe20B9a38E0c96F61d1bA6b42a61512D56Fea1Eb3
  - Base Sepolia: Resolver 0x21d4E9fbB9DB742E6ef4f29d189a7C18B0b59136, Host 0x109412E3C84f0539b43d39dB691B08c90f58dC7c, CFAv1 0x6836F23d6171D74Ef62FcF776655aBcD2bcd62Ef, SuperTokenFactory 0x7447E94Dfe3d804a9f46Bf12838d467c912C8F6C

Requirements
- .env: EOA_DEPLOYER, ETHERSCAN_API_KEY
- Bun + Node, Hardhat, Anvil for local Base fork

Scripts and flows
- Tests (Base fork):
  ```sh
  bun run test
  ```
- Multi-vault aggregation (optional): set VAULT_ADDRESSES as a comma-separated list and (optionally) VAULT_HOLDERS as a comma-separated list (defaults to SHARE_HOLDER for all). (SHARE_TOKEN_ADDRESSES is accepted for backward compatibility.)
    ```sh
    SHARE_TOKEN_ADDRESSES=0xVault1,0xVault2 \
    VAULT_HOLDERS=0xHolder1,0xHolder2 \
    bunx hardhat test --network anvil
    ```
- Local wrapper discovery/creation (PR4):
  - Discover existing wrapper or create if not present (set CREATE_WRAPPER=true):
    ```sh
    CREATE_WRAPPER=true bunx hardhat run scripts/wrapper/create.ts --network anvil
    ```
  - Or against base/mainnet:
    ```sh
    bunx hardhat run scripts/wrapper/create.ts --network base
    ```
- Deploy RewardsManager with Hardhat Ignition (consolidated manager):
- Prepare parameters by filling ignition/parameters/RewardsManager.sample.json and saving as, for example, ignition/parameters/RewardsManager.base.json
- Values required: sendx (pre-existing SuperToken wrapper), sendEarnFactory, asset (USDC), admin (DEFAULT_ADMIN_ROLE holder), minAssets. The contract creates the Superfluid pool in its constructor; it no longer creates the SuperToken wrapper.
  - Deploy:
    ```sh
bunx hardhat ignition deploy ./ignition/modules/RewardsManager.ts \
      --network base \
      --parameters ignition/parameters/RewardsManager.base.json
    ```
  - Example module structure mirrors: /Users/vict0xr/Documents/Send/send-token-upgrade/ignition/modules/SendToken.ts
  - See Ignition docs for parameters JSON: https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-ignition
- Local deploy orchestration (anvil state helper):
  ```sh
  ./bin/anvil-deploy
  ```
- Fund a holder with vault shares locally (to exercise syncVault in tests):
  ```sh
  VAULT_ADDRESS=0xVault \
  SHARE_HOLDER=0xHolder \
  AMOUNT_ASSETS=1000000 \
  bunx hardhat run scripts/rewards/fundHolder.ts --network anvil
  ```
  (SHARE_TOKEN_ADDRESS is accepted for backward compatibility.)
- Wrapper address persistence
  - deployments/wrapper.{chainId}.json

Environment flags (for later PRs)
- CREATE_WRAPPER=true: force creating the wrapper on the fork
- SEND_HOLDER=0x...: address to impersonate for upgrade/downgrade test
- RUN_CFA_SMOKE=true: run optional CFA lifecycle smoke test

References (Rule 3: mirror official examples; no custom Solidity)
- SuperTokenFactory: https://docs.superfluid.finance/superfluid/protocol-developers/supertokens/supertokenfactory
- ISuperToken: https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/interfaces/superfluid/ISuperToken.sol
- CFAv1: https://docs.superfluid.finance/superfluid/developers/constant-flow-agreement-cfa
- Hardhat + Viem: https://github.com/NomicFoundation/hardhat-viem
- Hardhat Ignition: https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-ignition
