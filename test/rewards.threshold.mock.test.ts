import { expect } from "chai";
import hre from "hardhat";
import fs from "fs/promises";
import path from "node:path";
import { getContract, zeroAddress } from "viem";
import { getConfig } from "../config/superfluid";

async function readJson(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

async function getWrapperAddress(): Promise<`0x${string}` | null> {
  const publicClient = await hre.viem.getPublicClient();
  const [walletClient] = await hre.viem.getWalletClients();
  if (!walletClient) throw new Error("Wallet client not configured");

  const chainId = await publicClient.getChainId();
  const cfg = getConfig(chainId);

  // Try deployments cache
  try {
    const deployments = await hre.run("read-file", { path: `deployments/wrapper.${chainId}.json` }).catch(() => null as any);
    if (deployments) {
      const parsed = JSON.parse(deployments);
      if (parsed?.address && parsed.address !== "") return parsed.address;
    }
  } catch {}

  // Try canonical mapping
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

describe("RewardsManager threshold tracking with live Superfluid (mocked SendEarn)", function () {
  it("tracks users above minAssets and updates pool units (env-gated)", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);

    // Load artifacts
    const root = path.resolve(__dirname, "..", "artifacts", "contracts");
    const rm = await readJson(path.resolve(root, "rewards", "RewardsManager.sol", "RewardsManager.json"));
    const mockERC20 = await readJson(path.resolve(root, "mocks", "MockERC20.sol", "MockERC20.json"));
    const mockVault = await readJson(path.resolve(root, "mocks", "MockERC4626Vault.sol", "MockERC4626Vault.json"));
    const mockFactory = await readJson(path.resolve(root, "mocks", "MockSendEarnFactory.sol", "MockSendEarnFactory.json"));
    if (!rm?.abi || !mockERC20?.abi || !mockVault?.abi || !mockFactory?.abi) this.skip();

    // Resolve SENDx
    const sendx = await getWrapperAddress();
    if (!sendx) this.skip();

    // Deploy mock USDC
    const erc20Abi = mockERC20.abi as any[];
    const erc20Bytecode = (mockERC20.bytecode?.object ?? mockERC20.bytecode) as `0x${string}`;
    const hashUSDC = await walletClient.deployContract({ abi: erc20Abi, bytecode: erc20Bytecode, args: ["USDC", "USDC", 6], account: walletClient.account! });
    const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: hashUSDC });
    const usdc = usdcReceipt.contractAddress as `0x${string}`;

    // Deploy factory and vault; mark vault as SendEarn
    const factoryAbi = mockFactory.abi as any[];
    const factoryBytecode = (mockFactory.bytecode?.object ?? mockFactory.bytecode) as `0x${string}`;
    const hashF = await walletClient.deployContract({ abi: factoryAbi, bytecode: factoryBytecode, args: [], account: walletClient.account! });
    const fReceipt = await publicClient.waitForTransactionReceipt({ hash: hashF });
    const factory = fReceipt.contractAddress as `0x${string}`;
    const factoryC = getContract({ address: factory, abi: factoryAbi, client: { public: publicClient, wallet: walletClient } });

    const vaultAbi = mockVault.abi as any[];
    const vaultBytecode = (mockVault.bytecode?.object ?? mockVault.bytecode) as `0x${string}`;
    const hashV = await walletClient.deployContract({ abi: vaultAbi, bytecode: vaultBytecode, args: [usdc, "vUSDC", "vUSDC", 1, 1], account: walletClient.account! });
    const vReceipt = await publicClient.waitForTransactionReceipt({ hash: hashV });
    const vault = vReceipt.contractAddress as `0x${string}`;

    const { request: setSE } = await factoryC.simulate.setIsSendEarn([vault, true], { account: walletClient.account! });
    await walletClient.writeContract(setSE);

    // Deploy RewardsManager with existing SENDx and create a live Superfluid pool
    const rmAbi = rm.abi as any[];
    const rmBytecode = (rm.bytecode?.object ?? rm.bytecode) as `0x${string}`;
    const minAssets = 100n;
    const hashRM = await walletClient.deployContract({
      abi: rmAbi,
      bytecode: rmBytecode,
      args: [sendx, factory, usdc, walletClient.account!.address, minAssets],
      account: walletClient.account!,
    });
    const rmReceipt = await publicClient.waitForTransactionReceipt({ hash: hashRM });
    const manager = rmReceipt.contractAddress as `0x${string}`;
    const rewards = getContract({ address: manager, abi: rmAbi, client: { public: publicClient, wallet: walletClient } });

    // Initially untracked
    const trackedBefore = await rewards.read.getTrackedUserCount([]) as bigint;
    expect(trackedBefore).to.eq(0n);

    // Mint 50 shares (< min) and sync => still untracked; units should be 50
    const vaultC = getContract({ address: vault, abi: vaultAbi, client: { public: publicClient, wallet: walletClient } });
    const { request: mint50 } = await vaultC.simulate.mint([walletClient.account!.address, 50n], { account: walletClient.account! });
    await walletClient.writeContract(mint50);

    const { request: sync1 } = await rewards.simulate.syncVault([vault, walletClient.account!.address], { account: walletClient.account! });
    await walletClient.writeContract(sync1);

    const trackedMid = await rewards.read.getTrackedUserCount([]) as bigint;
    expect(trackedMid).to.eq(0n);

    // Mint +100 shares to cross threshold and sync => tracked
    const { request: mint100 } = await vaultC.simulate.mint([walletClient.account!.address, 100n], { account: walletClient.account! });
    await walletClient.writeContract(mint100);

    const { request: sync2 } = await rewards.simulate.syncVault([vault, walletClient.account!.address], { account: walletClient.account! });
    await walletClient.writeContract(sync2);

    const trackedAfter = await rewards.read.getTrackedUserCount([]) as bigint;
    expect(trackedAfter).to.eq(1n);

    const who0 = await rewards.read.getTrackedUserAt([0n]) as `0x${string}`;
    expect(who0.toLowerCase()).to.eq(walletClient.account!.address.toLowerCase());

    const vCount = await rewards.read.getUserVaultCount([walletClient.account!.address]) as bigint;
    expect(vCount).to.eq(1n);

    const v0 = await rewards.read.getUserVaultAt([walletClient.account!.address, 0n]) as `0x${string}`;
    expect(v0.toLowerCase()).to.eq(vault.toLowerCase());

    // Raise threshold above current assets; sync => removed from tracking
    const { request: setMin } = await rewards.simulate.setMinAssets([1000n], { account: walletClient.account! });
    await walletClient.writeContract(setMin);

    const { request: sync3 } = await rewards.simulate.syncVault([vault, walletClient.account!.address], { account: walletClient.account! });
    await walletClient.writeContract(sync3);

    const trackedFinal = await rewards.read.getTrackedUserCount([]) as bigint;
    expect(trackedFinal).to.eq(0n);

    // Verify pool units using live ISuperfluidPool ABI
    const poolAddr = await rewards.read.pool([]) as `0x${string}`;
    const poolAbiJson = await readJson(path.resolve(__dirname, "..", "artifacts", "@superfluid-finance", "ethereum-contracts", "contracts", "interfaces", "agreements", "gdav1", "ISuperfluidPool.sol", "ISuperfluidPool.json"));
    if (poolAbiJson?.abi) {
      const pool = getContract({ address: poolAddr, abi: poolAbiJson.abi as any[], client: { public: publicClient } });
      const units = await pool.read.getUnits([walletClient.account!.address]) as bigint;
      expect(units).to.eq(150n);
    }
  });
});

