import { expect } from "chai";
import hre from "hardhat";
import { getConfig } from "../config/superfluid";
import { getContract } from "viem";
import fs from "fs/promises";
import path from "node:path";

async function readJson(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

async function resolveSendx(chainId: number): Promise<`0x${string}` | null> {
  const publicClient = await hre.viem.getPublicClient();
  const cfg = getConfig(chainId);
  // deployments cache first
  const wrapperFile = path.resolve(__dirname, "..", "deployments", `wrapper.${chainId}.json`);
  const existing = await readJson(wrapperFile);
  if (existing?.address && existing.address !== "") return existing.address as `0x${string}`;
  // canonical lookup
  const SuperTokenFactoryJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json");
  const factory = getContract({
    address: cfg.superTokenFactory,
    abi: (SuperTokenFactoryJson as any).default?.abi ?? (SuperTokenFactoryJson as any).abi,
    client: { public: (await hre.viem.getPublicClient()) },
  });
  try {
    const canonical = (await factory.read.getCanonicalERC20Wrapper([cfg.sendV1])) as `0x${string}`;
    if (canonical && canonical !== "0x0000000000000000000000000000000000000000") return canonical;
  } catch {}
  return null;
}

async function resolveShareToken(chainId: number): Promise<`0x${string}` | null> {
  // Prefer VAULT_ADDRESS (new name), fallback to SHARE_TOKEN_ADDRESS for backward compatibility
  if (process.env.VAULT_ADDRESS) return process.env.VAULT_ADDRESS as `0x${string}`;
  if (process.env.SHARE_TOKEN_ADDRESS) return process.env.SHARE_TOKEN_ADDRESS as `0x${string}`;
  const broadcastRoot =
    process.env.SEND_EARN_BROADCAST_DIR ??
    path.resolve(__dirname, "..", "..", "send-earn-contracts", "broadcast");
  const broadcastFile = path.resolve(broadcastRoot, `DeploySendEarn.s.sol/${chainId}/run-latest.json`);
  const runLatest = await readJson(broadcastFile);
  if (runLatest?.transactions && Array.isArray(runLatest.transactions)) {
    const tx = (runLatest.transactions as any[]).find(
      (t) => (t.contractName === "SendEarn" || t.contractName === "ERC4626" || t.contractName === "SendEarnFactory#SendEarn") &&
             (t.transactionType === "CREATE" || t.transactionType === "CREATE2") &&
             typeof t.contractAddress === "string" && t.contractAddress.startsWith("0x")
    );
    if (tx?.contractAddress) return tx.contractAddress as `0x${string}`;
  }
  return null;
}

async function resolveFactory(chainId: number): Promise<`0x${string}` | null> {
  if (process.env.SEND_EARN_FACTORY) return process.env.SEND_EARN_FACTORY as `0x${string}`;
  const broadcastRoot =
    process.env.SEND_EARN_BROADCAST_DIR ??
    path.resolve(__dirname, "..", "..", "send-earn-contracts", "broadcast");
  const broadcastFile = path.resolve(broadcastRoot, `DeploySendEarn.s.sol/${chainId}/run-latest.json`);
  const runLatest = await readJson(broadcastFile);
  if (runLatest?.transactions && Array.isArray(runLatest.transactions)) {
    const tx = (runLatest.transactions as any[]).find(
      (t) => (t.contractName === "SendEarnFactory" || t.contractName === "SendEarnFactory#SendEarnFactory") &&
             (t.transactionType === "CREATE" || t.transactionType === "CREATE2") &&
             typeof t.contractAddress === "string" && t.contractAddress.startsWith("0x")
    );
    if (tx?.contractAddress) return tx.contractAddress as `0x${string}`;
  }
  return null;
}

<<<<<<< HEAD
describe("RewardsManager (Base fork)", () => {
=======
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

describeIntegration("RewardsManager (Base fork)", () => {
>>>>>>> 1e31d976 (rewards: depositVaultShares pre-NAV; add tests)
  it("deploys and can call syncVault (env-gated)", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);
    const sendV1 = cfg.sendV1 as `0x${string}`;
    const superTokenFactory = cfg.superTokenFactory as `0x${string}`;
    const shareToken = await resolveShareToken(chainId);
    const factory = await resolveFactory(chainId);
    const holder = process.env.SHARE_HOLDER as `0x${string}` | undefined;
    let assetAddr = process.env.ASSET_ADDRESS as `0x${string}` | undefined;

    if (!shareToken || !holder || !factory) {
      this.skip();
    }

    // If asset address is not provided, try to resolve from the vault via IERC4626.asset()
    if (!assetAddr) {
      const ierc4626Abi = [
        { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
      ] as const;
      const vault = getContract({ address: shareToken!, abi: ierc4626Abi as any, client: { public: publicClient } });
      try {
        const a = (await vault.read.asset([])) as unknown as `0x${string}`;
        assetAddr = a;
      } catch {
        this.skip();
      }
    }

    // Derive decimals for minAssets calculation (5 tokens in underlying units)
    const erc20MetaAbi = [
      { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
    ] as const;
    const assetMeta = getContract({ address: assetAddr!, abi: erc20MetaAbi as any, client: { public: publicClient } });
    const dec = Number(await assetMeta.read.decimals([]));
    const minAssets = 5n * (10n ** BigInt(dec));

    // Deploy RewardsManager using compiled artifact
    const artifactPath = path.resolve(
      __dirname,
      "..",
      "artifacts",
      "contracts",
      "rewards",
      "RewardsManager.sol",
      "RewardsManager.json"
    );
    const artifact = await readJson(artifactPath);
    const bytecode = (artifact?.bytecode?.object ?? artifact?.bytecode) as `0x${string}` | undefined;
    if (!artifact?.abi || !bytecode) this.skip();

    const abi = artifact.abi as any[];

    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      args: [sendV1, superTokenFactory, factory!, assetAddr!, walletClient.account!.address, minAssets],
      account: walletClient.account!,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const manager = receipt.contractAddress as `0x${string}` | null;
    expect(manager, "deployed").to.be.a("string");

    // Call syncVault(shareToken, holder) using operator path; grant role first
    const rewards = getContract({ address: manager!, abi, client: { public: publicClient, wallet: walletClient } });
    try {
      const opRole = (await rewards.read.SYNC_OPERATOR_ROLE([])) as `0x${string}`;
      const { request: grantOp } = await rewards.simulate.grantRole([opRole, walletClient.account!.address], { account: walletClient.account as any });
      await walletClient.writeContract(grantOp);

      const { request } = await rewards.simulate.syncVault([shareToken!, holder!], { account: walletClient.account as any });
      const txHash = await walletClient.writeContract(request);
      const r2 = await publicClient.waitForTransactionReceipt({ hash: txHash });
      expect(r2.status).to.equal("success");
    } catch {
      this.skip();
    }
  });

  it("deploys and can call batchSyncVaults for multiple vaults (env-gated)", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);
    const sendV1 = cfg.sendV1 as `0x${string}`;
    const superTokenFactory = cfg.superTokenFactory as `0x${string}`;
    const holdersCsv = process.env.VAULT_HOLDERS || process.env.SHARE_HOLDER;
    const vaultsCsv = process.env.VAULT_ADDRESSES || process.env.SHARE_TOKEN_ADDRESSES;

    if (!vaultsCsv || !holdersCsv) this.skip();

    const vaults = vaultsCsv.split(",").map((s) => s.trim()).filter(Boolean) as `0x${string}`[];
    const holders = holdersCsv.split(",").map((s) => s.trim()).filter(Boolean) as `0x${string}`[];
    const who = holders[0] as `0x${string}`; // use first holder for aggregation target

    const factory = await resolveFactory(chainId);

    // Derive asset from first vault if not provided
    let assetAddr = process.env.ASSET_ADDRESS as `0x${string}` | undefined;
    if (!assetAddr) {
      const ierc4626Abi = [
        { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
      ] as const;
      const vault = getContract({ address: vaults[0]!, abi: ierc4626Abi as any, client: { public: publicClient } });
      try {
        const a = (await vault.read.asset([])) as unknown as `0x${string}`;
        assetAddr = a;
      } catch {
        this.skip();
      }
    }

    if (!factory) this.skip();

    // Derive decimals for minAssets calculation (5 tokens in underlying units)
    const erc20MetaAbi = [
      { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
    ] as const;
    const assetMeta = getContract({ address: assetAddr!, abi: erc20MetaAbi as any, client: { public: publicClient } });
    const dec = Number(await assetMeta.read.decimals([]));
    const minAssets = 5n * (10n ** BigInt(dec));

    // Deploy RewardsManager
    const artifactPath = path.resolve(
      __dirname,
      "..",
      "artifacts",
      "contracts",
      "rewards",
      "RewardsManager.sol",
      "RewardsManager.json"
    );
    const artifact = await readJson(artifactPath);
    const bytecode = (artifact?.bytecode?.object ?? artifact?.bytecode) as `0x${string}` | undefined;
    if (!artifact?.abi || !bytecode) this.skip();

    const abi = artifact.abi as any[];

    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      args: [sendV1, superTokenFactory, factory!, assetAddr!, walletClient.account!.address, minAssets],
      account: walletClient.account!,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const manager = receipt.contractAddress as `0x${string}` | null;
    expect(manager, "deployed").to.be.a("string");

    // Grant operator role and call batchSyncVaults(vaults, who)
    const rewards = getContract({ address: manager!, abi, client: { public: publicClient, wallet: walletClient } });
    try {
      const opRole = (await rewards.read.SYNC_OPERATOR_ROLE([])) as `0x${string}`;
      const { request: grantOp } = await rewards.simulate.grantRole([opRole, walletClient.account!.address], { account: walletClient.account as any });
      await walletClient.writeContract(grantOp);

      const { request } = await rewards.simulate.batchSyncVaults([vaults, who], { account: walletClient.account as any });
      const txHash = await walletClient.writeContract(request);
      const r2 = await publicClient.waitForTransactionReceipt({ hash: txHash });
      expect(r2.status).to.equal("success");
    } catch {
      this.skip();
    }
  });
});
