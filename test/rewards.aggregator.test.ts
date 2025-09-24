import { expect } from "chai";
import hre from "hardhat";
import { getConfig } from "../config/superfluid";
import { getContract } from "viem";
import fs from "fs/promises";
import path from "node:path";

async function readJson(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

describe("RewardsAggregator (CFA flows)", function () {
  it("creates/updates CFA flow on deposit/withdraw (no env)", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);

    // Load artifacts
    const artifactsRoot = path.resolve(__dirname, "..", "artifacts", "contracts");
    const aggArtifact = await readJson(path.resolve(artifactsRoot, "rewards", "RewardsAggregator.sol", "RewardsAggregator.json"));
    const mockErc20Artifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockERC20.sol", "MockERC20.json"));
    const mockVaultArtifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockERC4626Vault.sol", "MockERC4626Vault.json"));
    const mockFactoryArtifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockSendEarnFactory.sol", "MockSendEarnFactory.json"));
    if (!aggArtifact?.abi || !aggArtifact?.bytecode || !mockErc20Artifact?.abi || !mockVaultArtifact?.abi || !mockFactoryArtifact?.abi) this.skip();

    // 1) Underlying asset (6 decimals) and SuperToken wrapper
    const erc20Abi = mockErc20Artifact.abi as any[];
    const erc20Bytecode = (mockErc20Artifact.bytecode?.object ?? mockErc20Artifact.bytecode) as `0x${string}`;
    const hashUSDC = await walletClient.deployContract({ abi: erc20Abi, bytecode: erc20Bytecode, args: ["USDC", "USDC", 6], account: walletClient.account! });
    const receiptUSDC = await publicClient.waitForTransactionReceipt({ hash: hashUSDC });
    const usdc = receiptUSDC.contractAddress as `0x${string}` | null;
    if (!usdc) this.skip();

    // Create wrapper via SuperTokenFactory
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SuperTokenFactoryJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json");
    const factorySF = getContract({ address: cfg.superTokenFactory, abi: (SuperTokenFactoryJson as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });
    const { request: createReq, result: sendxRes } = await factorySF.simulate.createERC20Wrapper([usdc, 6, 1, cfg.wrapperName, cfg.wrapperSymbol], { account: walletClient.account! });
    const txCreate = await walletClient.writeContract(createReq);
    await publicClient.waitForTransactionReceipt({ hash: txCreate });
    const sendx = sendxRes as unknown as `0x${string}`;

    // 2) Deploy mock SendEarnFactory and a valid vault
    const mockFactoryAbi = mockFactoryArtifact.abi as any[];
    const mockFactoryBytecode = (mockFactoryArtifact.bytecode?.object ?? mockFactoryArtifact.bytecode) as `0x${string}`;
    const hashF = await walletClient.deployContract({ abi: mockFactoryAbi, bytecode: mockFactoryBytecode, args: [], account: walletClient.account! });
    const receiptF = await publicClient.waitForTransactionReceipt({ hash: hashF });
    const factoryAddr = receiptF.contractAddress as `0x${string}`;
    const factoryC = getContract({ address: factoryAddr, abi: mockFactoryAbi, client: { public: publicClient, wallet: walletClient } });

    const mockVaultAbi = mockVaultArtifact.abi as any[];
    const mockVaultBytecode = (mockVaultArtifact.bytecode?.object ?? mockVaultArtifact.bytecode) as `0x${string}`;
    const hashV = await walletClient.deployContract({ abi: mockVaultAbi, bytecode: mockVaultBytecode, args: [usdc, "vUSDC", "vUSDC", 1, 1], account: walletClient.account! });
    const receiptV = await publicClient.waitForTransactionReceipt({ hash: hashV });
    const vault = receiptV.contractAddress as `0x${string}`;

    // Mark vault as SendEarn-approved
    const { request: setSE } = await factoryC.simulate.setIsSendEarn([vault, true], { account: walletClient.account! });
    await walletClient.writeContract(setSE);

    // 3) Deploy RewardsAggregator
    const aggAbi = aggArtifact.abi as any[];
    const aggBytecode = (aggArtifact.bytecode?.object ?? aggArtifact.bytecode) as `0x${string}`;
    const hashAgg = await walletClient.deployContract({ abi: aggAbi, bytecode: aggBytecode, args: [sendx, factoryAddr, usdc, walletClient.account!.address], account: walletClient.account! });
    const receiptAgg = await publicClient.waitForTransactionReceipt({ hash: hashAgg });
    const aggregator = receiptAgg.contractAddress as `0x${string}` | null;
    if (!aggregator) this.skip();

    const agg = getContract({ address: aggregator!, abi: aggAbi, client: { public: publicClient, wallet: walletClient } });

    // 4) Configure high per-second rate (secondsPerYear=1) and pre-fund aggregator with SENDx
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ISuperTokenJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/ISuperToken.json");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IERC20Json = await import("@superfluid-finance/ethereum-contracts/build/truffle/IERC20.json");

    await agg.write.setSecondsPerYear([1n], { account: walletClient.account! });

    const underlying = getContract({ address: usdc!, abi: (IERC20Json as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });
    // Mint underlying to wallet for upgrade funding and deposit
    const minterAbi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }] as const;
    const minter = getContract({ address: usdc!, abi: minterAbi as any, client: { public: publicClient, wallet: walletClient } });

    const fundUnderlying = 10_000_000_000n; // 10,000 USDC (6 decimals)
    await minter.write.mint([walletClient.account!.address, fundUnderlying]);

    const superToken = getContract({ address: sendx, abi: (ISuperTokenJson as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });
    await underlying.write.approve([sendx, fundUnderlying], { account: walletClient.account! });
    await superToken.write.upgrade([fundUnderlying], { account: walletClient.account! });

    // Transfer SENDx to aggregator so it can open flows
    const fundSendx = 5_000_000_000n; // 5,000 USDC worth in SENDx
    await superToken.write.transfer([aggregator!, fundSendx], { account: walletClient.account! });

    // 5) Deposit underlying via aggregator: approve + depositAssets
    const depositAmount = 1_000_000n; // 1 USDC
    await underlying.write.approve([aggregator!, depositAmount], { account: walletClient.account! });

    const { request: depReq } = await agg.simulate.depositAssets([vault, depositAmount], { account: walletClient.account! });
    const depHash = await walletClient.writeContract(depReq);
    await publicClient.waitForTransactionReceipt({ hash: depHash });

    // 6) Verify CFA flow exists and equals expected per-second rate
    // flowRate = floor(depositAmount * 0.03) since secondsPerYear=1 and exchangeRate=1
    const expectedRate = (depositAmount * 3n) / 100n;

    // Read CFA getFlow
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IConstantFlowAgreementV1Json = await import("@superfluid-finance/ethereum-contracts/build/truffle/IConstantFlowAgreementV1.json");
    const cfa = getContract({ address: cfg.cfaV1, abi: (IConstantFlowAgreementV1Json as any).default.abi as any[], client: { public: publicClient } });
    const flowInfo = await cfa.read.getFlow([sendx, aggregator!, walletClient.account!.address]) as any[];
    const onchainRate = BigInt(flowInfo[3] ?? flowInfo[1] ?? 0); // ABI variants: result index differs across builds
    expect(onchainRate).to.eq(expectedRate);

    // 7) Withdraw everything; expect flow to be deleted (rate -> 0)
    const { request: wReq } = await agg.simulate.withdrawAssets([vault, depositAmount, walletClient.account!.address], { account: walletClient.account! });
    const wHash = await walletClient.writeContract(wReq);
    await publicClient.waitForTransactionReceipt({ hash: wHash });

    const flowAfter = await cfa.read.getFlow([sendx, aggregator!, walletClient.account!.address]) as any[];
    const rateAfter = BigInt(flowAfter[3] ?? flowAfter[1] ?? 0);
    expect(rateAfter).to.eq(0n);

    // 8) Vault gating: invalid vault should revert
    const invalidVault = `0x${"b".repeat(40)}` as `0x${string}`;
    let reverted = false;
    try {
      await agg.simulate.depositAssets([invalidVault, 1n], { account: walletClient.account! });
    } catch { reverted = true; }
    expect(reverted).to.eq(true);
  });
});
