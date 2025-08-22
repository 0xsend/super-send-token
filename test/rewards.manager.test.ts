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
    client: { public: publicClient },
  });
  try {
    const canonical = (await factory.read.getCanonicalERC20Wrapper([cfg.sendV1])) as `0x${string}`;
    if (canonical && canonical !== "0x0000000000000000000000000000000000000000") return canonical;
  } catch {}
  return null;
}

async function resolveShareToken(chainId: number): Promise<`0x${string}` | null> {
  if (process.env.SHARE_TOKEN_ADDRESS) return process.env.SHARE_TOKEN_ADDRESS as `0x${string}`;
  const broadcastFile = `/Users/vict0xr/Documents/Send/send-earn-contracts/broadcast/DeploySendEarn.s.sol/${chainId}/run-latest.json`;
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

describe("RewardsManager (Base fork)", () => {
  it("deploys and can call sync (env-gated)", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const sendx = await resolveSendx(chainId);
    const shareToken = await resolveShareToken(chainId);
    const poolAddr = process.env.REWARDS_POOL_ADDRESS as `0x${string}` | undefined;
    const holder = process.env.SHARE_HOLDER as `0x${string}` | undefined;

    if (!sendx || !shareToken || !poolAddr || !holder) {
      this.skip();
    }

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
    if (!artifact?.abi || !artifact?.bytecode?.object) this.skip();

    const abi = artifact.abi as any[];
    const bytecode = artifact.bytecode.object as `0x${string}`;

    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      args: [sendx, shareToken, poolAddr, walletClient.account!.address],
      account: walletClient.account!,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const manager = receipt.contractAddress as `0x${string}` | null;
    expect(manager, "deployed").to.be.a("string");

    // Call sync(holder); if pool accepts the call, tx should succeed
    const rewards = getContract({ address: manager!, abi, client: { public: publicClient, wallet: walletClient } });
    const { request } = await rewards.simulate.sync([holder], { account: walletClient.account! });
    const txHash = await walletClient.writeContract(request);
    const r2 = await publicClient.waitForTransactionReceipt({ hash: txHash });
    expect(r2.status).to.equal("success");
  });
});
