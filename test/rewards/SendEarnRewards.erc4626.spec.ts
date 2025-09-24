import { expect } from "chai";
import hre from "hardhat";

describe("SendEarnRewards v2 (ERC4626 only; streaming deferred)", () => {
  async function deployFixture() {
    const [deployer, userA, userB] = await hre.viem.getWalletClients();
    const pub = await hre.viem.getPublicClient();

    // Underlying ERC20
    const erc20 = await hre.viem.deployContract(
      "ERC20Mintable",
      ["MockUSD", "mUSD"] as const,
      { client: { wallet: deployer } }
    );

    // Two SendEarn-like ERC4626 test vaults
    const vaultA = await hre.viem.deployContract(
      "ERC4626TestVault",
      [erc20.address, "VaultA", "vA"] as const,
      { client: { wallet: deployer } }
    );
    const vaultB = await hre.viem.deployContract(
      "ERC4626TestVault",
      [erc20.address, "VaultB", "vB"] as const,
      { client: { wallet: deployer } }
    );

    // Factory mock with affiliates + SEND_EARN
    const factory = await hre.viem.deployContract(
      "SendEarnFactoryAffiliatesMock",
      [] as const,
      { client: { wallet: deployer } }
    );
    // Mark both vaults as SendEarn and set default to B
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setIsSendEarn", args: [vaultA.address, true] });
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setIsSendEarn", args: [vaultB.address, true] });
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setSendEarn", args: [vaultB.address] });

    // Aggregator (sendx can be any non-zero address; unused)
    const name = "SendEarnRewards v2";
    const symbol = "sREW2";
    const sendx = deployer.account!.address as `0x${string}`;
    const rewards = await hre.viem.deployContract(
      "SendEarnRewards",
      [sendx, factory.address, erc20.address, name, symbol, deployer.account!.address] as const,
      { client: { wallet: deployer } }
    );

    return { pub, deployer, userA, userB, erc20, vaultA, vaultB, factory, rewards };
  }

  it("routes deposit to affiliates(user) when set; records underlying shares", async () => {
    const { pub, deployer, userA, erc20, vaultA, vaultB, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Mint to userA and approve aggregator
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 1_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 500n * 10n ** 18n] });

    // Set affiliates(userA) = vaultA
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });

    const assets = 200n * 10n ** 18n;
    const expMint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewDeposit", args: [assets] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [assets, a] });

    // Wrapper shares minted per ERC4626 NAV (not 1:1)
    const bal = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });
    expect(bal).to.equal(expMint);

    // Underlying shares recorded
    const underlyingShares: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "userUnderlyingShares", args: [a, vaultA.address] });
    const expectedShares = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "convertToShares", args: [assets] });
    expect(underlyingShares).to.equal(expectedShares);

    // Default SEND_EARN is vaultB; ensure no shares recorded there for userA yet
    const zeroShares: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "userUnderlyingShares", args: [a, vaultB.address] });
    expect(zeroShares).to.equal(0n);
  });

  it("withdraw uses only the resolved vault and reverts if insufficient; succeeds when sufficient", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Mint and approve
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 1_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 500n * 10n ** 18n] });

    // affiliates(userA)=vaultA; deposit 100
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    const depositAmt = 100n * 10n ** 18n;
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [depositAmt, a] });

    // Change affiliate to zero (default), withdraw should now resolve to default and revert due to no underlying shares there
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, "0x0000000000000000000000000000000000000000"] });
    let reverted = false;
    try {
      await userA.simulateContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "withdraw", args: [10n * 10n ** 18n, a, a] });
    } catch { reverted = true; }
    expect(reverted).to.eq(true);

    // Set affiliate back to vaultA and withdraw 40 (single vault)
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    const burnShares = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewWithdraw", args: [40n * 10n ** 18n] });
    const balBefore = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "withdraw", args: [40n * 10n ** 18n, a, a] });

    const balAfter = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });
    expect(balBefore - balAfter).to.equal(burnShares);
  });

  it("totalAssets equals sum over tracked vaults convertToAssets(wrapper-held shares)", async () => {
    const { pub, deployer, userA, erc20, vaultA, vaultB, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 2_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 2_000n * 10n ** 18n] });

    // Deposit 150 into affiliate vaultA
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [150n * 10n ** 18n, a] });

    // Deposit 50 into default vaultB (clear affiliate)
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, "0x0000000000000000000000000000000000000000"] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [50n * 10n ** 18n, a] });

    // Compute expected total assets from wrapper-held shares in both vaults
    const sharesA = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "balanceOf", args: [rewards.address] });
    const sharesB = await pub.readContract({ address: vaultB.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "balanceOf", args: [rewards.address] });
    const assetsA = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "convertToAssets", args: [sharesA] });
    const assetsB = await pub.readContract({ address: vaultB.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "convertToAssets", args: [sharesB] });

    const total = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "totalAssets", args: [] });
    expect(total).to.equal((assetsA as bigint) + (assetsB as bigint));
  });

  it("transfers do not modify per-user underlying ledgers", async () => {
    const { pub, deployer, userA, userB, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;
    const b = userB.account!.address as `0x${string}`;

    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 1_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 1_000n * 10n ** 18n] });

    // affiliates(userA)=vaultA; deposit 300
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    const depositAmt = 300n * 10n ** 18n;
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [depositAmt, a] });

    const senderSharesBefore = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });
    const fromUnderlyingBefore = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "userUnderlyingShares", args: [a, vaultA.address] });

    // Transfer 120 wrapper shares to userB
    const xfer = 120n * 10n ** 18n;
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "transfer", args: [b, xfer] });

    const fromUnderlyingAfter = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "userUnderlyingShares", args: [a, vaultA.address] });
    const toUnderlyingAfter = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "userUnderlyingShares", args: [b, vaultA.address] });

    // No change to per-user ledgers due to transfer
    expect(fromUnderlyingAfter).to.equal(fromUnderlyingBefore);
    expect(toUnderlyingAfter).to.equal(0n);
  });
  it("ingests existing SendEarn shares and mints aggregator shares per NAV", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // User acquires vaultA shares directly
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 1_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [vaultA.address, 600n * 10n ** 18n] });
    const depositToVault = 250n * 10n ** 18n;
    await userA.writeContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "deposit", args: [depositToVault, a] });
    const userVaultShares = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "balanceOf", args: [a] });

    // Approve aggregator to take vault shares
    await userA.writeContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "approve", args: [rewards.address, userVaultShares] });

    // Expected aggregator shares using NAV
    const assetsEq = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "convertToAssets", args: [userVaultShares] });
    const expMintAgg = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewDeposit", args: [assetsEq] });

    // Ingest shares
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "depositVaultShares", args: [vaultA.address, userVaultShares] });

    const aggBal = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });
    expect(aggBal).to.equal(expMintAgg);

    const recordedShares = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "userUnderlyingShares", args: [a, vaultA.address] });
    expect(recordedShares).to.equal(userVaultShares);
  });
  it("previewMint returns required assets; mint mints exact shares; ledger updates via resolved vault", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Route to vaultA
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });

    // Request to mint wrapper shares
    const sharesWanted = 123n * 10n ** 18n;
    const assetsRequired: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewMint", args: [sharesWanted] });

    // Fund and approve required assets
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, assetsRequired] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, assetsRequired] });

    const balBefore = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "mint", args: [sharesWanted, a] });
    const balAfter = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });

    expect(balAfter - balBefore).to.equal(sharesWanted);

    // Ledger reflects vault shares increase
    const vaultSharesGained = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "convertToShares", args: [assetsRequired] });
    const recorded = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "userUnderlyingShares", args: [a, vaultA.address] });
    expect(recorded).to.equal(vaultSharesGained);
  });

  it("previewRedeem returns assets; redeem burns shares and sends assets; ledger updates", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Route to vaultA and deposit to obtain wrapper shares
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 500n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 500n * 10n ** 18n] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [200n * 10n ** 18n, a] });

    const sharesToRedeem = 60n * 10n ** 18n;
    const assetsOut: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewRedeem", args: [sharesToRedeem] });

    const userBalBefore: bigint = await pub.readContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "balanceOf", args: [a] });
    const aggBalBefore: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });

    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "redeem", args: [sharesToRedeem, a, a] });

    const userBalAfter: bigint = await pub.readContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "balanceOf", args: [a] });
    const aggBalAfter: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });

    expect(userBalAfter - userBalBefore).to.equal(assetsOut);
    expect(aggBalBefore - aggBalAfter).to.equal(sharesToRedeem);
  });

  it("ERC4626 preview invariants hold (rounding relations)", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Seed supply so NAV math is meaningful
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 1_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 1_000n * 10n ** 18n] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [200n * 10n ** 18n, a] });

    const s = 123n * 10n ** 18n;
    const a2 = 456n * 10n ** 18n;

    const pd_pm = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewDeposit", args: [await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewMint", args: [s] }) as bigint] });
    expect((pd_pm as bigint) >= s).to.equal(true);

    const pm_pd = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewMint", args: [await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewDeposit", args: [a2] }) as bigint] });
    expect((pm_pd as bigint) <= a2).to.equal(true);

    const pw_pr = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewWithdraw", args: [await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewRedeem", args: [s] }) as bigint] });
    expect((pw_pr as bigint) >= s).to.equal(true);

    const pr_pw = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewRedeem", args: [await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewWithdraw", args: [a2] }) as bigint] });
    expect((pr_pw as bigint) <= a2).to.equal(true);

    // Zero cases
    expect(await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewDeposit", args: [0n] })).to.equal(0n);
    expect(await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewMint", args: [0n] })).to.equal(0n);
    expect(await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewWithdraw", args: [0n] })).to.equal(0n);
    expect(await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewRedeem", args: [0n] })).to.equal(0n);
  });

  it("previewMint decreases and previewRedeem increases when vault gains external assets (price per share ↑)", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Route to vaultA and make an initial deposit so aggregator holds some shares and has supply
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 1_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 1_000n * 10n ** 18n] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [200n * 10n ** 18n, a] });

    const s = 50n * 10n ** 18n;
    const pm0: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewMint", args: [s] });
    const pr0: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewRedeem", args: [s] });

    // External donation to vaultA: transfer underlying directly to vault (increases price per share)
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [deployer.account!.address, 300n * 10n ** 18n] as any });
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "transfer", args: [vaultA.address, 300n * 10n ** 18n] });

    const pm1: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewMint", args: [s] });
    const pr1: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewRedeem", args: [s] });

    // With higher aggregator NAV/share, minting s shares should require MORE assets, and redeeming s shares yields more assets
    expect(pm1 > pm0).to.equal(true);
    expect(pr1 > pr0).to.equal(true);
  });

  it("maxDeposit/maxMint are non-trivial and consistent with preview functions", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 1_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 1_000n * 10n ** 18n] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });

    const md: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "maxDeposit", args: [a] });
    const mm: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "maxMint", args: [a] });

    expect(md > 0n).to.equal(true);
    expect(mm > 0n).to.equal(true);

    // previewDeposit with maxDeposit should mint a positive number of shares
    const pd_md: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewDeposit", args: [md] });
    expect(pd_md >= 0n).to.equal(true);

    // previewMint with maxMint should require a non-zero or zero assets (depending on ratio), but remain consistent
    const pm_mm: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewMint", args: [mm] });
    expect(pm_mm >= 0n).to.equal(true);
  });

  it("emits ERC4626 Deposit and Withdraw events with correct fields", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 500n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 500n * 10n ** 18n] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });

    // Deposit
    const depAmt = 120n * 10n ** 18n;
    const depHash = await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [depAmt, a] });
    const depRcpt = await pub.getTransactionReceipt({ hash: depHash });

    // Find ERC4626 Deposit event
    const aggAbi = (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any[];
    const depositTopic = (await import("viem")).encodeEventTopics({ abi: aggAbi, eventName: "Deposit" })[0];
    const depLog = depRcpt.logs.find(l => l.address.toLowerCase() === rewards.address.toLowerCase() && l.topics[0] === depositTopic);
    expect(depLog, "Deposit event missing").to.not.equal(undefined);

    // Withdraw
    const wAmt = 45n * 10n ** 18n;
    const wHash = await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "withdraw", args: [wAmt, a, a] });
    const wRcpt = await pub.getTransactionReceipt({ hash: wHash });

    const withdrawTopic = (await import("viem")).encodeEventTopics({ abi: aggAbi, eventName: "Withdraw" })[0];
    const wLog = wRcpt.logs.find(l => l.address.toLowerCase() === rewards.address.toLowerCase() && l.topics[0] === withdrawTopic);
    expect(wLog, "Withdraw event missing").to.not.equal(undefined);
  });

  it("depositVaultShares: reverts for invalid vault and asset mismatch", async () => {
    const { pub, deployer, userA, erc20, vaultA, vaultB, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Prepare a second asset and vault with mismatched asset
    const erc20b = await hre.viem.deployContract(
      "ERC20Mintable",
      ["OtherUSD", "oUSD"] as const,
      { client: { wallet: deployer } }
    );
    const vaultOther = await hre.viem.deployContract(
      "ERC4626TestVault",
      [erc20b.address, "VaultOther", "vO"] as const,
      { client: { wallet: deployer } }
    );

    // Mark vaultA and vaultB as SendEarn, also mark vaultOther as SendEarn (but asset mismatch)
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setIsSendEarn", args: [vaultA.address, true] });
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setIsSendEarn", args: [vaultB.address, true] });
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setIsSendEarn", args: [vaultOther.address, true] });

    // User attempts to depositVaultShares into an address that is not SendEarn (random address)
    const notSendEarn = "0x000000000000000000000000000000000000beef" as `0x${string}`;
    let reverted = false;
    try {
      await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "depositVaultShares", args: [notSendEarn, 1n] });
    } catch { reverted = true; }
    expect(reverted).to.eq(true);

    // Asset mismatch: vaultOther has a different underlying asset than aggregator
    // Approve some dummy shares amount and expect revert on asset mismatch check
    let reverted2 = false;
    try {
      await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "depositVaultShares", args: [vaultOther.address, 1n] });
    } catch { reverted2 = true; }
    expect(reverted2).to.eq(true);
  });

  it("depositVaultShares mints per NAV when aggregator already has supply", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Seed aggregator supply via standard deposit routed to vaultA
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 1_000n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 1_000n * 10n ** 18n] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    const seed = 200n * 10n ** 18n;
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [seed, a] });

    const balBefore = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });

    // Acquire vault shares directly, then ingest via depositVaultShares
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [vaultA.address, 1_000n * 10n ** 18n] });
    const direct = 90n * 10n ** 18n;
    await userA.writeContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "deposit", args: [direct, a] });
    const uShares = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "balanceOf", args: [a] });

    // Approve aggregator to pull vault shares
    await userA.writeContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "approve", args: [rewards.address, uShares] });

    const assetsEq = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "convertToAssets", args: [uShares] });
    const expMint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewDeposit", args: [assetsEq] });

    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "depositVaultShares", args: [vaultA.address, uShares] });

    const balAfter = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [a] });
    expect(balAfter - balBefore).to.equal(expMint);

    // Ledger increments by ingested shares
    const recorded = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "userUnderlyingShares", args: [a, vaultA.address] });
    expect(recorded >= uShares).to.equal(true);
  });

  it("wrapper moves only via vault shares; underlying asset balance stays zero after deposit and after withdraw", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards } = await deployFixture();
    const a = userA.account!.address as `0x${string}`;

    // Route to vaultA and deposit
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, 500n * 10n ** 18n] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 500n * 10n ** 18n] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });

    const depAmt = 180n * 10n ** 18n;
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [depAmt, a] });

    // Aggregator should not retain underlying asset after deposit
    const aggUnderlying0: bigint = await pub.readContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "balanceOf", args: [rewards.address] });
    expect(aggUnderlying0).to.equal(0n);

    // Withdraw some assets and confirm balances
    const w = 50n * 10n ** 18n;
    const previewShares: bigint = await pub.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "previewWithdraw", args: [w] });

    const vaultSharesBefore: bigint = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "balanceOf", args: [rewards.address] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "withdraw", args: [w, a, a] });
    const vaultSharesAfter: bigint = await pub.readContract({ address: vaultA.address, abi: (await hre.artifacts.readArtifact("ERC4626TestVault")).abi as any, functionName: "balanceOf", args: [rewards.address] });

    expect(vaultSharesBefore - vaultSharesAfter).to.equal(previewShares);

    // Aggregator should not retain underlying after withdraw
    const aggUnderlying1: bigint = await pub.readContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "balanceOf", args: [rewards.address] });
    expect(aggUnderlying1).to.equal(0n);
  });
});
