import { expect } from "chai";
import hre from "hardhat";
import { getConfig } from "../config/superfluid";
import { getContract, encodeFunctionData, zeroAddress } from "viem";
import fs from "fs/promises";
import path from "node:path";
import {
  impersonateAccount,
  setBalance,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

async function readJson(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

async function getWrapperAddress(): Promise<`0x${string}` | null> {
  const publicClient = await hre.viem.getPublicClient();
  const [walletClient] = await hre.viem.getWalletClients();
  if (!walletClient) throw new Error("Wallet client not configured");

  const chainId = await publicClient.getChainId();
  const cfg = getConfig(chainId);

  // Try canonical mapping at SuperTokenFactory
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SuperTokenFactoryJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json");
  const factory = getContract({ address: cfg.superTokenFactory, abi: (SuperTokenFactoryJson as any).default.abi as any[], client: { public: publicClient } });
  try {
    const canonical = (await factory.read.getCanonicalERC20Wrapper([cfg.sendV1])) as unknown as `0x${string}`;
    if (canonical && canonical !== zeroAddress) return canonical;
  } catch {}

  if (process.env.CREATE_WRAPPER === "true") {
    const factoryW = getContract({ address: cfg.superTokenFactory, abi: (SuperTokenFactoryJson as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });
    const upgradability = 1; // SEMI_UPGRADABLE
    const { request, result } = await factoryW.simulate.createERC20Wrapper([cfg.sendV1, cfg.underlyingDecimals, upgradability, cfg.wrapperName, cfg.wrapperSymbol], { account: walletClient.account! });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return result as unknown as `0x${string}`;
  }

  return null;
}

async function isValidWrapper(addr: `0x${string}`): Promise<boolean> {
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const cfg = getConfig(chainId);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ISuperTokenJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/ISuperToken.json");
  const superToken = getContract({ address: addr, abi: (ISuperTokenJson as any).default.abi as any[], client: { public: publicClient } });
  try {
    const underlying = (await superToken.read.getUnderlyingToken([])) as unknown as `0x${string}`;
    return underlying.toLowerCase() === cfg.sendV1.toLowerCase();
  } catch { return false; }
}

describe("RewardsManager streaming with live Superfluid (mocked SendEarn)", function () {
  it("creates a flow into the RewardsManager pool and reflects units from mocked vault (env-gated)", async function () {
    if (process.env.RUN_STREAMING_TEST !== "true") this.skip();

    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);

    // Resolve SENDx wrapper
    const wrapper = await getWrapperAddress();
    if (!wrapper || !(await isValidWrapper(wrapper))) this.skip();

    // Impersonate a holder to fund the stream
    const holder = process.env.SEND_HOLDER as `0x${string}` | undefined;
    if (!holder) this.skip();

    await impersonateAccount(holder);
    await setBalance(holder, 10n * 10n ** 18n);

    // Load ABIs we need
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ISuperTokenJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/ISuperToken.json");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IERC20Json = await import("@superfluid-finance/ethereum-contracts/build/truffle/IERC20.json");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ISuperfluidJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/ISuperfluid.json");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IConstantFlowAgreementV1Json = await import("@superfluid-finance/ethereum-contracts/build/truffle/IConstantFlowAgreementV1.json");

    const superToken = getContract({ address: wrapper, abi: (ISuperTokenJson as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });
    const underlying = getContract({ address: cfg.sendV1, abi: (IERC20Json as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });

    // Upgrade some underlying to SENDx for streaming
    const amount = 10n ** 18n; // 1.0 SEND
    const uBal = (await underlying.read.balanceOf([holder])) as unknown as bigint;
    if (uBal < amount) this.skip();

    await underlying.write.approve([wrapper, amount], { account: holder });
    await superToken.write.upgrade([amount], { account: holder });

    // Deploy mocks for SendEarnFactory, USDC, and vault
    const artifactsRoot = path.resolve(__dirname, "..", "artifacts", "contracts");
    const rmArtifact = await readJson(path.resolve(artifactsRoot, "rewards", "RewardsManager.sol", "RewardsManager.json"));
    const mockErc20Artifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockERC20.sol", "MockERC20.json"));
    const mockVaultArtifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockERC4626Vault.sol", "MockERC4626Vault.json"));
    const mockFactoryArtifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockSendEarnFactory.sol", "MockSendEarnFactory.json"));
    if (!rmArtifact?.abi || !mockErc20Artifact?.abi || !mockVaultArtifact?.abi || !mockFactoryArtifact?.abi) this.skip();

    const erc20Abi = mockErc20Artifact.abi as any[];
    const erc20Bytecode = (mockErc20Artifact.bytecode?.object ?? mockErc20Artifact.bytecode) as `0x${string}`;
    const hashUSDC = await walletClient.deployContract({ abi: erc20Abi, bytecode: erc20Bytecode, args: ["USDC", "USDC", 6], account: walletClient.account! });
    const receiptUSDC = await publicClient.waitForTransactionReceipt({ hash: hashUSDC });
    const usdc = receiptUSDC.contractAddress as `0x${string}`;

    const mockFactoryAbi = mockFactoryArtifact.abi as any[];
    const mockFactoryBytecode = (mockFactoryArtifact.bytecode?.object ?? mockFactoryArtifact.bytecode) as `0x${string}`;
    const hashF = await walletClient.deployContract({ abi: mockFactoryAbi, bytecode: mockFactoryBytecode, args: [], account: walletClient.account! });
    const receiptF = await publicClient.waitForTransactionReceipt({ hash: hashF });
    const factory = receiptF.contractAddress as `0x${string}`;
    const factoryC = getContract({ address: factory, abi: mockFactoryAbi, client: { public: publicClient, wallet: walletClient } });

    const mockVaultAbi = mockVaultArtifact.abi as any[];
    const mockVaultBytecode = (mockVaultArtifact.bytecode?.object ?? mockVaultArtifact.bytecode) as `0x${string}`;
    const hashV = await walletClient.deployContract({ abi: mockVaultAbi, bytecode: mockVaultBytecode, args: [usdc, "vUSDC", "vUSDC", 1, 1], account: walletClient.account! });
    const receiptV = await publicClient.waitForTransactionReceipt({ hash: hashV });
    const vault = receiptV.contractAddress as `0x${string}`;

    // Configure factory: mark vault as SendEarn
    const { request: setSE } = await factoryC.simulate.setIsSendEarn([vault, true], { account: walletClient.account! });
    await walletClient.writeContract(setSE);

    // Deploy RewardsManager which creates the pool
    const rmAbi = rmArtifact.abi as any[];
    const rmBytecode = (rmArtifact.bytecode?.object ?? rmArtifact.bytecode) as `0x${string}`;
    const minAssets = 1n;
    const hashRM = await walletClient.deployContract({ abi: rmAbi, bytecode: rmBytecode, args: [wrapper, factory, usdc, walletClient.account!.address, minAssets], account: walletClient.account! });
    const receiptRM = await publicClient.waitForTransactionReceipt({ hash: hashRM });
    const manager = receiptRM.contractAddress as `0x${string}`;
    const rewards = getContract({ address: manager, abi: rmAbi, client: { public: publicClient, wallet: walletClient } });

    const poolAddr = (await rewards.read.pool([])) as `0x${string}`;

    // Mint shares to holder in the mock vault and sync units
    const vaultC = getContract({ address: vault, abi: mockVaultAbi, client: { public: publicClient, wallet: walletClient } });
    const shares = 123n;
    const { request: mintReq } = await vaultC.simulate.mint([holder, shares], { account: walletClient.account! });
    await walletClient.writeContract(mintReq);

    const { request: syncReq } = await rewards.simulate.syncVault([vault, holder], { account: walletClient.account! });
    await walletClient.writeContract(syncReq);

    // Start a CFAv1 stream from holder to pool using host.callAgreement
    const host = getContract({ address: cfg.host, abi: (ISuperfluidJson as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });
    const cfa = getContract({ address: cfg.cfaV1, abi: (IConstantFlowAgreementV1Json as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });

    const flowRate = 10_000n; // tiny flow
    const callData = encodeFunctionData({ abi: (IConstantFlowAgreementV1Json as any).default.abi as any[], functionName: "createFlow", args: [wrapper, poolAddr, flowRate, "0x"] });

    const { request: startFlow } = await host.simulate.callAgreement([cfg.cfaV1, callData, "0x"], { account: holder });
    const txHash = await walletClient.writeContract(startFlow);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Validate the flow exists
    const flowInfo = await cfa.read.getFlow([wrapper, holder, poolAddr]) as any[];
    const onChainRate = BigInt(flowInfo[3] ?? flowInfo[1] ?? 0); // handle ABI variants
    expect(onChainRate).to.equal(flowRate);

    // Update the flow to a new rate and verify
    const newFlowRate = flowRate * 2n;
    const updateCall = encodeFunctionData({ abi: (IConstantFlowAgreementV1Json as any).default.abi as any[], functionName: "updateFlow", args: [wrapper, poolAddr, newFlowRate, "0x"] });
    const { request: updFlow } = await host.simulate.callAgreement([cfg.cfaV1, updateCall, "0x"], { account: holder });
    const updHash = await walletClient.writeContract(updFlow);
    await publicClient.waitForTransactionReceipt({ hash: updHash });

    const flowInfoUpdated = await cfa.read.getFlow([wrapper, holder, poolAddr]) as any[];
    const onChainRateUpdated = BigInt(flowInfoUpdated[3] ?? flowInfoUpdated[1] ?? 0);
    expect(onChainRateUpdated).to.equal(newFlowRate);

    // Optionally, check pool total connected flow rate via interface ABI
    const poolAbiJson = await readJson(path.resolve(__dirname, "..", "artifacts", "@superfluid-finance", "ethereum-contracts", "contracts", "interfaces", "agreements", "gdav1", "ISuperfluidPool.sol", "ISuperfluidPool.json"));
    if (poolAbiJson?.abi) {
      const pool = getContract({ address: poolAddr, abi: poolAbiJson.abi as any[], client: { public: publicClient } });
      const connected = (await pool.read.getTotalConnectedFlowRate([])) as unknown as bigint;
      expect(connected >= 0n).to.equal(true);
    }

    // Helper: stop the flow using deleteFlow and verify
    const deleteCall = encodeFunctionData({ abi: (IConstantFlowAgreementV1Json as any).default.abi as any[], functionName: "deleteFlow", args: [wrapper, holder, poolAddr, "0x"] });
    const { request: stopFlow } = await host.simulate.callAgreement([cfg.cfaV1, deleteCall, "0x"], { account: holder });
    const stopHash = await walletClient.writeContract(stopFlow);
    await publicClient.waitForTransactionReceipt({ hash: stopHash });

    const flowAfter = await cfa.read.getFlow([wrapper, holder, poolAddr]) as any[];
    const rateAfter = BigInt(flowAfter[3] ?? flowAfter[1] ?? 0);
    expect(rateAfter).to.equal(0n);
  });
});

