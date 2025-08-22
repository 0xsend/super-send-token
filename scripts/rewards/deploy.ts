import hre from "hardhat";
import fs from "fs/promises";
import path from "node:path";
import { getConfig } from "../../config/superfluid";
import { getContract } from "viem";
import SuperTokenFactoryJson from "@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json";

// This script mirrors patterns from scripts/wrapper/create.ts:
// - viem public/wallet clients
// - readJson/writeJson helpers
// - canonical wrapper discovery via SuperTokenFactory.getCanonicalERC20Wrapper
// It avoids introducing new deployment patterns beyond what's necessary.

async function readJson(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

async function writeJson(file: string, data: any) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function main() {
  const publicClient = await hre.viem.getPublicClient();
  const [walletClient] = await hre.viem.getWalletClients();
  if (!walletClient) throw new Error("No wallet client available. Configure accounts for the selected network.");
  const account = walletClient.account!;

  const chainId = await publicClient.getChainId();
  const cfg = getConfig(chainId);

  // 1) Resolve SENDx (wrapper)
  const wrapperFile = path.resolve(__dirname, "..", "..", "deployments", `wrapper.${chainId}.json`);
  let sendx: `0x${string}` | null = null;
  const existingWrapper = await readJson(wrapperFile);
  if (existingWrapper?.address && existingWrapper.address !== "") {
    sendx = existingWrapper.address as `0x${string}`;
  } else {
    const factoryAbi = (SuperTokenFactoryJson as any).abi as any[];
    const factory = getContract({ address: cfg.superTokenFactory, abi: factoryAbi, client: { public: publicClient } });
    try {
      const canonical = (await factory.read.getCanonicalERC20Wrapper([cfg.sendV1])) as `0x${string}`;
      if (canonical && canonical !== "0x0000000000000000000000000000000000000000") {
        sendx = canonical;
      }
    } catch (e) {
      // ignore and fall through
    }
  }
  if (!sendx) {
    throw new Error(
      `SENDx wrapper not found. Create it first (see scripts/wrapper/create.ts) or ensure deployments/wrapper.${chainId}.json is populated.`
    );
  }

  // 2) Resolve ERC-4626 share token (from send-earn-contracts broadcasts or env override)
  let shareToken: `0x${string}` | null = null;
  if (process.env.SHARE_TOKEN_ADDRESS) {
    shareToken = process.env.SHARE_TOKEN_ADDRESS as `0x${string}`;
  } else {
    const broadcastFile = `/Users/vict0xr/Documents/Send/send-earn-contracts/broadcast/DeploySendEarn.s.sol/${chainId}/run-latest.json`;
    const runLatest = await readJson(broadcastFile);
    if (runLatest?.transactions && Array.isArray(runLatest.transactions)) {
      // Scan for a CREATE/CREATE2 of SendEarn vault; we expect its address to be the ERC-4626 share token
      const tx = (runLatest.transactions as any[]).find(
        (t) => (t.contractName === "SendEarn" || t.contractName === "ERC4626" || t.contractName === "SendEarnFactory#SendEarn") &&
               (t.transactionType === "CREATE" || t.transactionType === "CREATE2") &&
               typeof t.contractAddress === "string" && t.contractAddress.startsWith("0x")
      );
      if (tx?.contractAddress) {
        shareToken = tx.contractAddress as `0x${string}`;
      }
    }
  }
  if (!shareToken) {
    throw new Error(
      `Could not resolve ERC-4626 share token. Set SHARE_TOKEN_ADDRESS env var or ensure broadcast run-latest.json includes SendEarn creation for chain ${chainId}.`
    );
  }

  // 3) Require an existing Pool address (created externally following official Pool examples)
  const poolAddr = process.env.REWARDS_POOL_ADDRESS as `0x${string}` | undefined;
  if (!poolAddr) {
    throw new Error(
      "REWARDS_POOL_ADDRESS env is required. Create the Superfluid Pool for SENDx using the official Pools guide (via SuperTokenV1Library) and provide its address."
    );
  }

  // 4) Deploy RewardsManager (using compiled artifacts)
  const artifactPath = path.resolve(
    __dirname,
    "..",
    "..",
    "artifacts",
    "contracts",
    "rewards",
    "RewardsManager.sol",
    "RewardsManager.json"
  );
  const artifact = await readJson(artifactPath);
  if (!artifact?.abi || !artifact?.bytecode?.object) {
    throw new Error("RewardsManager artifact not found. Run `bunx hardhat compile` first.");
  }

  const abi = artifact.abi as any[];
  const bytecode = artifact.bytecode.object as `0x${string}`;

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [sendx, shareToken, poolAddr, account.address],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const managerAddress = receipt.contractAddress as `0x${string}` | null;
  if (!managerAddress) throw new Error("RewardsManager deployment failed (no contractAddress in receipt)");

  const outFile = path.resolve(__dirname, "..", "..", "deployments", `rewards.${chainId}.json`);
  await writeJson(outFile, {
    rewardsManager: managerAddress,
    pool: poolAddr,
    sendx,
    shareToken,
    chainId,
    createdAt: Number(receipt.blockNumber),
  });

  console.log(managerAddress);
}

main().catch((err) => {
  console.error("[rewards] Error:", err);
  process.exit(1);
});

