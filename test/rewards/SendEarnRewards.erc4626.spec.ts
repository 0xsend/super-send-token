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
});
