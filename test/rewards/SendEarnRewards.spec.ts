import { expect } from "chai";
import hre from "hardhat";

// This test validates ERC4626 bubbling via hooks and CFA flow updates
// for SendEarnRewards. It uses local mocks for Host/CFA and minimal
// ERC20 + ERC4626 test vault.

describe("SendEarnRewards ERC4626 + CFA flows", () => {
  it("updates mapping on join (assets=0), then deposit/withdraw bubbles and updates flow", async () => {
    const publicClient = await hre.viem.getPublicClient();
    const [deployer, user] = await hre.viem.getWalletClients();
    const userAddr = user.account!.address as `0x${string}`;

    // Deploy Superfluid mocks
    const cfa = await hre.viem.deployContract("CFAMock", ["0x0000000000000000000000000000000000000000"] as const, { client: { wallet: deployer } });
    const host = await hre.viem.deployContract("HostMock", [cfa.address] as const, { client: { wallet: deployer } });
    await deployer.writeContract({ address: cfa.address, abi: (await hre.artifacts.readArtifact("CFAMock")).abi as any, functionName: "setHost", args: [host.address] });
    const sendx = await hre.viem.deployContract("SuperTokenMock", [host.address] as const, { client: { wallet: deployer } });

    // ERC20 + ERC4626 vault
    const erc20 = await hre.viem.deployContract("ERC20Mintable", ["MockUSD", "mUSD"] as const, { client: { wallet: deployer } });
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [userAddr, 2_000n * 10n ** 18n] as any });
    const vault = await hre.viem.deployContract("ERC4626TestVault", [erc20.address, "TestVault", "tVAULT"] as const, { client: { wallet: deployer } });

    // Factory mock with affiliates mapping
    const factory = await hre.viem.deployContract("SendEarnFactoryAffiliatesMock", [] as const, { client: { wallet: deployer } });
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setIsSendEarn", args: [vault.address, true] });

    // Deploy SendEarnRewards
    const name = "Send Earn Rewards";
    const symbol = "sREW";
    const rewards = await hre.viem.deployContract("SendEarnRewards", [sendx.address, factory.address, erc20.address, name, symbol, deployer.account!.address] as const, { client: { wallet: deployer } });

    // Set affiliate mapping on factory for this user
    await user.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [userAddr, vault.address] });

    // Approve and deposit 100
    await user.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, 1_000n * 10n ** 18n] });
    const assets = 100n * 10n ** 18n;
    await user.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [assets, userAddr] });

    // Verify 1:1 shares and ledger
    const bal = await publicClient.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "balanceOf", args: [userAddr] });
    expect(bal).to.equal(assets);
    const userVaultAssets: bigint = await publicClient.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "getUserVaultAssets", args: [userAddr, vault.address] });
    expect(userVaultAssets).to.equal(assets);

    // Flow rate matches 3% APR / secondsPerYear
    const secondsPerYear: bigint = await publicClient.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "secondsPerYear", args: [] });
    const annualBps: bigint = await publicClient.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "annualRateBps", args: [] });
    const flow1: bigint = await publicClient.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "getFlowRate", args: [userAddr] });
    const expectedPerSec = (assets * annualBps / 10000n) / secondsPerYear;
    expect(flow1).to.equal(expectedPerSec);

    // Withdraw 40 and ensure flow adjusts
    const withdrawAssets = 40n * 10n ** 18n;
    await user.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "withdraw", args: [withdrawAssets, userAddr, userAddr] });
    const flow2: bigint = await publicClient.readContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "getFlowRate", args: [userAddr] });
    const expectedPerSec2 = ((assets - withdrawAssets) * annualBps / 10000n) / secondsPerYear;
    expect(flow2).to.equal(expectedPerSec2);
  });
});
