import { expect } from "chai";
import hre from "hardhat";

// CFA v2.1 tests (will fail until implementation wires SuperTokenV1Library.flow and policy)
// We use local Superfluid mocks (CFAMock, HostMock, SuperTokenMock) to observe flow updates.

const describeCFA = process.env.RUN_CFA === "true" ? describe : describe.skip;

describeCFA("SendEarnRewards v2.1 (CFA flows)", () => {
  async function deployCfaFixture() {
    const pub = await hre.viem.getPublicClient();
    const [deployer, userA, userB] = await hre.viem.getWalletClients();

    // Superfluid mocks
    const cfa = await hre.viem.deployContract("CFAMock", ["0x0000000000000000000000000000000000000000"] as const, { client: { wallet: deployer } });
    const host = await hre.viem.deployContract("HostMock", [cfa.address] as const, { client: { wallet: deployer } });
    await deployer.writeContract({ address: cfa.address, abi: (await hre.artifacts.readArtifact("CFAMock")).abi as any, functionName: "setHost", args: [host.address] });
    const sendx = await hre.viem.deployContract("SuperTokenMock", [host.address] as const, { client: { wallet: deployer } });

    // Underlying ERC20
    const erc20 = await hre.viem.deployContract("ERC20Mintable", ["MockUSD", "mUSD"] as const, { client: { wallet: deployer } });

    // Two SendEarn-like ERC4626 test vaults
    const vaultA = await hre.viem.deployContract("ERC4626TestVault", [erc20.address, "VaultA", "vA"] as const, { client: { wallet: deployer } });
    const vaultB = await hre.viem.deployContract("ERC4626TestVault", [erc20.address, "VaultB", "vB"] as const, { client: { wallet: deployer } });

    // Factory mock with affiliates + SEND_EARN
    const factory = await hre.viem.deployContract("SendEarnFactoryAffiliatesMock", [] as const, { client: { wallet: deployer } });
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setIsSendEarn", args: [vaultA.address, true] });
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setIsSendEarn", args: [vaultB.address, true] });
    await deployer.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setSendEarn", args: [vaultB.address] });

    // Aggregator (sendx wired here for CFA)
    const rewards = await hre.viem.deployContract(
      "SendEarnRewards",
      [sendx.address, factory.address, erc20.address, "SendEarnRewards v2", "sREW2", deployer.account!.address] as const,
      { client: { wallet: deployer } }
    );

    return { pub, deployer, userA, userB, erc20, vaultA, vaultB, factory, rewards, cfa, host, sendx };
  }

  function expectedPerSecond(assets: bigint) {
    // Placeholder policy mirrors docs defaults: 3% APR, secondsPerYear ~ 365 days, exchangeRate 1e18
    const annualBps = 300n; // 3%
    const secondsPerYear = 365n * 24n * 60n * 60n;
    const exchangeRateWad = 10n ** 18n; // 1:1
    const wad = assets * exchangeRateWad;
    const annual = wad * annualBps / 10000n;
    const perSec = annual / secondsPerYear / (10n ** 18n);
    return perSec; // int96 expected later, bigint suffices for expectation
  }

  it("deposit sets a non-zero flow equal to f(aggregated assets)", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards, cfa, sendx } = await deployCfaFixture();
    const a = userA.account!.address as `0x${string}`;

    // Mint and approve deposit
    const dep = 200n * 10n ** 18n;
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, dep] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, dep] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });

    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [dep, a] });

    // Read CFA flow: aggregator -> user
    const flowInfo = await pub.readContract({ address: cfa.address, abi: (await hre.artifacts.readArtifact("CFAMock")).abi as any, functionName: "getFlow", args: [sendx.address, rewards.address, a] });
    const onchainRate = BigInt((flowInfo as any[])[1] ?? 0);

    const exp = expectedPerSecond(dep);
    expect(onchainRate).to.equal(exp); // will fail until flow() is wired with policy
  });

  it("withdraw to zero deletes the flow (rate=0)", async () => {
    const { pub, deployer, userA, erc20, vaultA, factory, rewards, cfa, sendx } = await deployCfaFixture();
    const a = userA.account!.address as `0x${string}`;

    const dep = 150n * 10n ** 18n;
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, dep] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, dep] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [dep, a] });

    // Withdraw everything
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "withdraw", args: [dep, a, a] });

    const flowInfo = await pub.readContract({ address: cfa.address, abi: (await hre.artifacts.readArtifact("CFAMock")).abi as any, functionName: "getFlow", args: [sendx.address, rewards.address, a] });
    const onchainRate = BigInt((flowInfo as any[])[1] ?? 0);
    expect(onchainRate).to.equal(0n); // will fail until flow() deletes on zero
  });

  it("aggregates across multiple vaults for flow sizing", async () => {
    const { pub, deployer, userA, erc20, vaultA, vaultB, factory, rewards, cfa, sendx } = await deployCfaFixture();
    const a = userA.account!.address as `0x${string}`;

    // First deposit routes to A
    const depA = 100n * 10n ** 18n;
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, depA] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, depA] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [depA, a] });

    // Second deposit goes to default vaultB (clear affiliate)
    const depB = 60n * 10n ** 18n;
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, depB] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, depB] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, "0x0000000000000000000000000000000000000000"] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [depB, a] });

    const flowInfo = await pub.readContract({ address: cfa.address, abi: (await hre.artifacts.readArtifact("CFAMock")).abi as any, functionName: "getFlow", args: [sendx.address, rewards.address, a] });
    const onchainRate = BigInt((flowInfo as any[])[1] ?? 0);

    const exp = expectedPerSecond(depA + depB);
    expect(onchainRate).to.equal(exp); // will fail until flow() uses aggregated assets
  });

  it("transfer of aggregator shares does not change flow (no trigger)", async () => {
    const { pub, deployer, userA, userB, erc20, vaultA, factory, rewards, cfa, sendx } = await deployCfaFixture();
    const a = userA.account!.address as `0x${string}`;
    const b = userB.account!.address as `0x${string}`;

    // Deposit to set an initial flow
    const dep = 80n * 10n ** 18n;
    await deployer.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "mint", args: [a, dep] as any });
    await userA.writeContract({ address: erc20.address, abi: (await hre.artifacts.readArtifact("ERC20Mintable")).abi as any, functionName: "approve", args: [rewards.address, dep] });
    await userA.writeContract({ address: factory.address, abi: (await hre.artifacts.readArtifact("SendEarnFactoryAffiliatesMock")).abi as any, functionName: "setAffiliate", args: [a, vaultA.address] });
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "deposit", args: [dep, a] });

    const flowBefore = await pub.readContract({ address: cfa.address, abi: (await hre.artifacts.readArtifact("CFAMock")).abi as any, functionName: "getFlow", args: [sendx.address, rewards.address, a] });
    const rateBefore = BigInt((flowBefore as any[])[1] ?? 0);

    // Transfer wrapper shares from A to B
    const xfer = 10n * 10n ** 18n;
    await userA.writeContract({ address: rewards.address, abi: (await hre.artifacts.readArtifact("SendEarnRewards")).abi as any, functionName: "transfer", args: [b, xfer] });

    const flowAfter = await pub.readContract({ address: cfa.address, abi: (await hre.artifacts.readArtifact("CFAMock")).abi as any, functionName: "getFlow", args: [sendx.address, rewards.address, a] });
    const rateAfter = BigInt((flowAfter as any[])[1] ?? 0);

    expect(rateAfter).to.equal(rateBefore); // no change on transfer
  });
});