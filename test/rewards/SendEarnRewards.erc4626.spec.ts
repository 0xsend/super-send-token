import { expect } from "chai";
import hre from "hardhat";

// v2 ERC4626 Aggregator tests (streaming deferred)
// Intent: outline domain behavior; many cases are pending until the implementation is rewritten.
// Template sources used (no blind code):
// - Existing spec structure: super-send-token/test/rewards/SendEarnRewards.spec.ts
// - Factory interface semantics: send-earn-contracts/src/interfaces/ISendEarnFactory.sol
// - Vault mocks: super-send-token/contracts/mocks/MinimalVault.sol (ERC4626TestVault)

describe("SendEarnRewards v2 (ERC4626 only; streaming deferred)", () => {
  it.skip("routes deposit to affiliates(caller) when set; otherwise prefers default SEND_EARN if caller already holds default shares", async function () {
    // Pending: requires v2 implementation (no CFA calls in hooks) and a factory mock exposing affiliates() and SEND_EARN().
    // Outline:
    // - Deploy ERC20Mintable (underlying)
    // - Deploy 2 ERC4626TestVaults (affiliateVault, defaultVault)
    // - Deploy SendEarnFactoryAffiliatesMock
    // - Set isSendEarn for both vaults; set SEND_EARN = defaultVault; set affiliates[user] = affiliateVault
    // - Deploy v2 aggregator (asset = underlying)
    // - Approve+deposit X assets via aggregator → expect aggregator to hold shares in affiliateVault
    // - Clear affiliates[user]; give user direct seUSDC in defaultVault; deposit again → expect route to defaultVault
  });

  it.skip("shares are transferable (no non-transferable override)", async function () {
    // Pending: current implementation overrides _update to disallow transfers.
    // Outline:
    // - Mint aggregator shares to user (via deposit)
    // - transfer to other user → should succeed
  });

  it.skip("totalAssets equals the sum over held SendEarn vault positions converted via convertToAssets", async function () {
    // Pending: current implementation uses 1:1 accounting; v2 should compute sum over held vaults.
    // Outline:
    // - After routing deposits to two vaults, read totalAssets and compare to per-vault convertToAssets balances
  });

it.skip("withdraw uses only the resolved vault and reverts if insufficient (no loops)", async function () {
    // Gas-efficient policy: no multi-vault loops in withdraw.
    // Outline:
    // - With positions in two vaults (historical deposits), set affiliates(owner) to affiliateVault so it resolves there
    // - Attempt withdraw X where affiliateVault can fully satisfy → succeeds and only that vault’s position decreases
    // - Attempt withdraw Y where affiliateVault cannot satisfy → expect revert (no fallback loop into other vault)
  });
});
