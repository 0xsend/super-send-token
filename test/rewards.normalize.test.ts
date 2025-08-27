import { expect } from "chai";
import hre from "hardhat";
import { getConfig } from "../config/superfluid";
import fs from "fs/promises";
import path from "node:path";
import { getContract } from "viem";

async function readJson(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

describe("RewardsManager vault normalization & validation (no env)", function () {
  it("reverts for invalid vault, normalizes affiliate, and rejects asset mismatch", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);

    // Load artifacts
    const artifactsRoot = path.resolve(__dirname, "..", "artifacts", "contracts");
    const rmArtifact = await readJson(path.resolve(artifactsRoot, "rewards", "RewardsManager.sol", "RewardsManager.json"));
    if (!rmArtifact?.abi || !(rmArtifact?.bytecode?.object || rmArtifact?.bytecode)) this.skip();

    const mockErc20Artifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockERC20.sol", "MockERC20.json"));
    const mockVaultArtifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockERC4626Vault.sol", "MockERC4626Vault.json"));
    const mockFactoryArtifact = await readJson(path.resolve(artifactsRoot, "mocks", "MockSendEarnFactory.sol", "MockSendEarnFactory.json"));
    if (!mockErc20Artifact?.abi || !mockVaultArtifact?.abi || !mockFactoryArtifact?.abi) this.skip();

    // 1) Deploy mock USDC asset (6 decimals)
    const mockErc20Abi = mockErc20Artifact.abi as any[];
    const mockErc20Bytecode = (mockErc20Artifact.bytecode?.object ?? mockErc20Artifact.bytecode) as `0x${string}`;
    const hashUSDC = await walletClient.deployContract({
      abi: mockErc20Abi,
      bytecode: mockErc20Bytecode,
      args: ["USDC", "USDC", 6],
      account: walletClient.account!,
    });
    const receiptUSDC = await publicClient.waitForTransactionReceipt({ hash: hashUSDC });
    const usdc = receiptUSDC.contractAddress as `0x${string}` | null;
    if (!usdc) this.skip();

    // 2) Create a SuperToken wrapper for the mock USDC via SuperTokenFactory
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SuperTokenFactoryJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json");
    const factory = getContract({ address: cfg.superTokenFactory, abi: (SuperTokenFactoryJson as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });
    const upgradability = 1; // SEMI_UPGRADABLE
    // Read decimals via public variable getter
    const erc20MetaAbi = [ { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] } ] as const;
    const meta = getContract({ address: usdc!, abi: erc20MetaAbi as any, client: { public: publicClient } });
    const dec = Number(await meta.read.decimals([]));
    const { request: createReq, result: createdWrapper } = await factory.simulate.createERC20Wrapper([usdc!, dec, upgradability, cfg.wrapperName, cfg.wrapperSymbol], { account: walletClient.account! });
    const createHash = await walletClient.writeContract(createReq);
    await publicClient.waitForTransactionReceipt({ hash: createHash });
    const sendx = createdWrapper as unknown as `0x${string}`;

    // 3) Deploy mock SendEarnFactory
    const mockFactoryAbi = mockFactoryArtifact.abi as any[];
    const mockFactoryBytecode = (mockFactoryArtifact.bytecode?.object ?? mockFactoryArtifact.bytecode) as `0x${string}`;
    const hashF = await walletClient.deployContract({ abi: mockFactoryAbi, bytecode: mockFactoryBytecode, args: [], account: walletClient.account! });
    const receiptF = await publicClient.waitForTransactionReceipt({ hash: hashF });
    const factoryAddr = receiptF.contractAddress as `0x${string}` | null;
    if (!factoryAddr) this.skip();
    const factoryC = getContract({ address: factoryAddr!, abi: mockFactoryAbi, client: { public: publicClient, wallet: walletClient } });

    // 4) Deploy a valid mock vault (1:1 shares->assets)
    const mockVaultAbi = mockVaultArtifact.abi as any[];
    const mockVaultBytecode = (mockVaultArtifact.bytecode?.object ?? mockVaultArtifact.bytecode) as `0x${string}`;
    const hashV = await walletClient.deployContract({ abi: mockVaultAbi, bytecode: mockVaultBytecode, args: [usdc!, "vUSDC", "vUSDC", 1, 1], account: walletClient.account! });
    const receiptV = await publicClient.waitForTransactionReceipt({ hash: hashV });
    const validVault = receiptV.contractAddress as `0x${string}` | null;
    if (!validVault) this.skip();
    const vaultC = getContract({ address: validVault!, abi: mockVaultAbi, client: { public: publicClient, wallet: walletClient } });

    // 5) Deploy a mismatched vault (wrong asset)
    const hashOther = await walletClient.deployContract({ abi: mockErc20Abi, bytecode: mockErc20Bytecode, args: ["DAI", "DAI", 18], account: walletClient.account! });
    const receiptOther = await publicClient.waitForTransactionReceipt({ hash: hashOther });
    const dai = receiptOther.contractAddress as `0x${string}` | null;
    if (!dai) this.skip();

    const hashVM = await walletClient.deployContract({ abi: mockVaultAbi, bytecode: mockVaultBytecode, args: [dai!, "vDAI", "vDAI", 1, 1], account: walletClient.account! });
    const receiptVM = await publicClient.waitForTransactionReceipt({ hash: hashVM });
    const mismatchVault = receiptVM.contractAddress as `0x${string}` | null;
    if (!mismatchVault) this.skip();

    // 6) Configure factory: mark validVault as SendEarn; set affiliate mapping
    const { request: setSE } = await factoryC.simulate.setIsSendEarn([validVault!, true], { account: walletClient.account! });
    await walletClient.writeContract(setSE);

    const affiliate: `0x${string}` = `0x${"a".padStart(40, "a")}` as any; // arbitrary address
    const { request: setAff } = await factoryC.simulate.setAffiliate([affiliate, validVault!], { account: walletClient.account! });
    await walletClient.writeContract(setAff);

    // 7) Deploy RewardsManager (minAssets = 1)
    const rmAbi = rmArtifact.abi as any[];
    const rmBytecode = (rmArtifact.bytecode?.object ?? rmArtifact.bytecode) as `0x${string}`;
    const hashRM = await walletClient.deployContract({
      abi: rmAbi,
      bytecode: rmBytecode,
      args: [sendx!, factoryAddr!, usdc!, walletClient.account!.address, 1n],
      account: walletClient.account!,
    });
    const receiptRM = await publicClient.waitForTransactionReceipt({ hash: hashRM });
    const manager = receiptRM.contractAddress as `0x${string}` | null;
    if (!manager) this.skip();

    const rewards = getContract({ address: manager!, abi: rmAbi, client: { public: publicClient, wallet: walletClient } });

    // Case A: invalid vault should revert (neither SendEarn nor affiliate)
    const invalidVault = `0x${"b".padStart(40, "b")}` as `0x${string}`;
    let reverted = false;
    try {
      await rewards.simulate.syncVault([invalidVault, walletClient.account!.address], { account: walletClient.account! });
    } catch (e: any) {
      reverted = true;
      expect(String(e?.message || e)).to.match(/invalid vault/);
    }
    expect(reverted, "invalid vault reverted").to.eq(true);

    // Case B: asset mismatch should revert
    const { request: setMismatchSE } = await factoryC.simulate.setIsSendEarn([mismatchVault!, true], { account: walletClient.account! });
    await walletClient.writeContract(setMismatchSE);

    let revertedMismatch = false;
    try {
      await rewards.simulate.syncVault([mismatchVault!, walletClient.account!.address], { account: walletClient.account! });
    } catch (e: any) {
      revertedMismatch = true;
      expect(String(e?.message || e)).to.match(/asset mismatch/);
    }
    expect(revertedMismatch, "asset mismatch reverted").to.eq(true);

    // Case C: affiliate should normalize to valid vault; after minting shares, totals should update
    const shares = 12345n;
    const { request: mintReq } = await vaultC.simulate.mint([walletClient.account!.address, shares], { account: walletClient.account! });
    await walletClient.writeContract(mintReq);

    const { request: syncReq } = await rewards.simulate.syncVault([affiliate, walletClient.account!.address], { account: walletClient.account! });
    const txHash = await walletClient.writeContract(syncReq);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Read totals
    const total = (await rewards.read.totalAssetsByUser([walletClient.account!.address])) as bigint;
    expect(total).to.equal(shares);

    const last = (await rewards.read.lastAssetsByVault([walletClient.account!.address, validVault!])) as bigint;
    expect(last).to.equal(shares);
  });
});

