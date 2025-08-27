import hre from "hardhat";
import fs from "fs/promises";
import path from "node:path";
import { getConfig } from "../../config/superfluid";
import { getContract } from "viem";

// This script mirrors patterns from scripts/wrapper/create.ts and deploys the consolidated assets-based manager.

async function readJson(file: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

async function writeJson(file: string, data: any) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Minimal IERC4626 ABI (reference: OpenZeppelin IERC4626 asset() view)
const IERC4626_ABI = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

async function main() {
  const publicClient = await hre.viem.getPublicClient();
  const [walletClient] = await hre.viem.getWalletClients();
  if (!walletClient) throw new Error("No wallet client available. Configure accounts for the selected network.");
  const account = walletClient.account!;

  const chainId = await publicClient.getChainId();
  const cfg = getConfig(chainId);

  // Resolve SendEarnFactory (prefer env; fallback to broadcast parsing similar to share token discovery)
  let sendEarnFactory: `0x${string}` | null = null;
  if (process.env.SEND_EARN_FACTORY) {
    sendEarnFactory = process.env.SEND_EARN_FACTORY as `0x${string}`;
  } else {
    const broadcastFile = `/Users/vict0xr/Documents/Send/send-earn-contracts/broadcast/DeploySendEarn.s.sol/${chainId}/run-latest.json`;
    const runLatest = await readJson(broadcastFile);
    if (runLatest?.transactions && Array.isArray(runLatest.transactions)) {
      const tx = (runLatest.transactions as any[]).find(
        (t) => (t.contractName === "SendEarnFactory" || t.contractName === "SendEarnFactory#SendEarnFactory") &&
               (t.transactionType === "CREATE" || t.transactionType === "CREATE2") &&
               typeof t.contractAddress === "string" && t.contractAddress.startsWith("0x")
      );
      if (tx?.contractAddress) {
        sendEarnFactory = tx.contractAddress as `0x${string}`;
      }
    }
  }
  if (!sendEarnFactory) {
    throw new Error(
      `Could not resolve SendEarnFactory. Set SEND_EARN_FACTORY env or ensure broadcast includes SendEarnFactory creation for chain ${chainId}.`
    );
  }

  // 1) Resolve SENDx SuperToken address (required)
  let sendx: `0x${string}` | null = null;
  if (process.env.SENDX_ADDRESS || process.env.SUPERTOKEN_ADDRESS) {
    sendx = (process.env.SENDX_ADDRESS as `0x${string}`) || (process.env.SUPERTOKEN_ADDRESS as `0x${string}`);
  } else {
    // Try deployments cache produced by scripts/wrapper/create.ts
    const wrapperFile = path.resolve(__dirname, "..", "..", "deployments", `wrapper.${chainId}.json`);
    const wrapperJson = await readJson(wrapperFile);
    if (wrapperJson?.address && typeof wrapperJson.address === "string" && wrapperJson.address.startsWith("0x")) {
      sendx = wrapperJson.address as `0x${string}`;
    }
  }
  if (!sendx) {
    throw new Error(
      `SENDx address not found. Set SENDX_ADDRESS (or SUPERTOKEN_ADDRESS) or run scripts/wrapper/create.ts to produce deployments/wrapper.${chainId}.json.`
    );
  }

  // 2) Resolve share token (vault) and derive underlying asset from it (always)
  let shareToken: `0x${string}` | null = null;
  let assetAddr: `0x${string}` | null = null;

  if (process.env.VAULT_ADDRESS || process.env.SHARE_TOKEN_ADDRESS) {
    shareToken = (process.env.VAULT_ADDRESS as `0x${string}`) || (process.env.SHARE_TOKEN_ADDRESS as `0x${string}`);
  } else {
    const broadcastFile = `/Users/vict0xr/Documents/Send/send-earn-contracts/broadcast/DeploySendEarn.s.sol/${chainId}/run-latest.json`;
    const runLatest = await readJson(broadcastFile);
    if (runLatest?.transactions && Array.isArray(runLatest.transactions)) {
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
      `Could not resolve ERC-4626 share token. Set VAULT_ADDRESS/SHARE_TOKEN_ADDRESS or ensure broadcast run-latest.json includes SendEarn creation for chain ${chainId}.`
    );
  }
  // Derive underlying asset from the vault (IERC4626.asset())
  const vault = getContract({ address: shareToken, abi: IERC4626_ABI as any, client: { public: publicClient } });
  assetAddr = (await vault.read.asset([])) as unknown as `0x${string}`;
  if (!assetAddr) throw new Error("Could not derive underlying asset from the provided vault");

  // Resolve minAssets from env (base units) or MIN_ASSETS_HUMAN (decimal string scaled by asset.decimals())
  let minAssets: bigint | null = null;
  if (process.env.MIN_ASSETS) {
    try {
      minAssets = BigInt(process.env.MIN_ASSETS);
    } catch {
      throw new Error("MIN_ASSETS must be a valid integer string in base units");
    }
  } else if (process.env.MIN_ASSETS_HUMAN) {
    const erc20MetaAbi = [
      { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
    ] as const;
    const assetMeta = getContract({ address: assetAddr!, abi: erc20MetaAbi as any, client: { public: publicClient } });
    const decimals = Number(await assetMeta.read.decimals([]));
    const human = process.env.MIN_ASSETS_HUMAN.trim();
    // parse decimal string into base units
    const match = human.match(/^\d+(?:\.\d+)?$/);
    if (!match) throw new Error("MIN_ASSETS_HUMAN must be a decimal number like '5' or '5.25'");
    const [intPart, fracPartRaw] = human.split(".");
    const fracPart = (fracPartRaw || "").padEnd(decimals, "0");
    if (fracPart.length > decimals) {
      throw new Error(`MIN_ASSETS_HUMAN has more fractional digits than asset decimals (${decimals})`);
    }
    const baseStr = `${intPart}${fracPart}`;
    try {
      minAssets = BigInt(baseStr);
    } catch {
      throw new Error("MIN_ASSETS_HUMAN parsed value is too large or invalid");
    }
  } else {
    throw new Error("Provide MIN_ASSETS (base units) or MIN_ASSETS_HUMAN (e.g., '5.25')");
  }

  // 3) Deploy RewardsManager (using compiled artifacts)
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
  if (!artifact?.abi || !(artifact?.bytecode?.object || artifact?.bytecode)) {
    throw new Error("RewardsManager artifact not found. Run `bunx hardhat compile` first.");
  }

  const abi = artifact.abi as any[];
  const bytecode = (artifact.bytecode?.object ?? artifact.bytecode) as `0x${string}`;

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [sendx, sendEarnFactory, assetAddr, account.address, minAssets],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const managerAddress = receipt.contractAddress as `0x${string}` | null;
  if (!managerAddress) throw new Error("RewardsManager deployment failed (no contractAddress in receipt)");

  // 4) Read the created pool address from the deployed contract
  const rewards = getContract({ address: managerAddress, abi, client: { public: publicClient } });
  let poolAddr: `0x${string}` | null = null;
  try {
    poolAddr = (await rewards.read.pool([])) as unknown as `0x${string}`;
  } catch {}

  const outFile = path.resolve(__dirname, "..", "..", "deployments", `rewards.${chainId}.json`);
  await writeJson(outFile, {
    rewardsManager: managerAddress,
    pool: poolAddr,
    sendx,
    sendEarnFactory,
    shareToken,
    asset: assetAddr,
    chainId,
    createdAt: Number(receipt.blockNumber),
  });

  console.log(managerAddress);
}

main().catch((err) => {
  console.error("[rewards] Error:", err);
  process.exit(1);
});

