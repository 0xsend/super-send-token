import hre from "hardhat";
import { getConfig } from "../../config/superfluid";
import fs from "fs/promises";
import path from "node:path";
import { getContract } from "viem";
// Rule 3 references (we mirror official examples; no custom Solidity):
// - SuperTokenFactory ABI and interface: https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/superfluid/SuperTokenFactory.sol
// - ISuperToken interface: https://github.com/superfluid-finance/protocol-monorepo/blob/dev/packages/ethereum-contracts/contracts/interfaces/superfluid/ISuperToken.sol
// - Hardhat + Viem usage: https://github.com/NomicFoundation/hardhat-viem

// Import ABIs from the official Superfluid package (installed as a dev dependency).
// We use the truffle JSON artifacts for ABIs only.
import SuperTokenFactoryJson from "@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json";
import ISuperTokenJson from "@superfluid-finance/ethereum-contracts/build/truffle/ISuperToken.json";

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

  // Allow overriding the underlying token for dev workflows (e.g., WETH on a fork)
  const underlyingOverride = process.env.UNDERLYING_ADDRESS as `0x${string}` | undefined;
  const underlying = (underlyingOverride && underlyingOverride.startsWith("0x")) ? underlyingOverride : (cfg.sendV1 as `0x${string}`);

  const deploymentsPath = path.resolve(__dirname, "..", "..", "deployments", `wrapper.${chainId}.json`);
  const existing = await readJson(deploymentsPath);

  const factoryAbi = SuperTokenFactoryJson.abi as any[];
  const superTokenAbi = ISuperTokenJson.abi as any[];

  const log = (...args: any[]) => console.log("[wrapper]", ...args);

  // Helper to validate a wrapper address on-chain
  const isValidWrapper = async (addr: `0x${string}`): Promise<boolean> => {
    try {
      const code = await publicClient.getBytecode({ address: addr });
      if (!code) return false;
      const superToken = getContract({ address: addr, abi: superTokenAbi, client: { public: publicClient } });
      const u = (await superToken.read.getUnderlyingToken([])) as unknown as `0x${string}`;
      return u.toLowerCase() === underlying.toLowerCase();
    } catch {
      return false;
    }
  };

  // 1) If deployments file has an address, attach if valid
  if (existing?.address && existing.address !== "") {
    const addr = existing.address as `0x${string}`;
    if (await isValidWrapper(addr)) {
      log("Found wrapper (deployments cache):", addr);
      console.log(addr);
      return;
    }
  }

  // 2) Try canonical mapping in the factory
  const factory = getContract({ address: cfg.superTokenFactory, abi: factoryAbi, client: { public: publicClient, wallet: walletClient } });
  try {
    const canonical = (await factory.read.getCanonicalERC20Wrapper([underlying])) as unknown as `0x${string}`;
    if (canonical && canonical !== "0x0000000000000000000000000000000000000000" && await isValidWrapper(canonical)) {
      log("Found canonical wrapper:", canonical);
      const block = await publicClient.getBlockNumber();
      await writeJson(deploymentsPath, { address: canonical, underlying, createdAt: Number(block), chainId, factory: cfg.superTokenFactory });
      console.log(canonical);
      return;
    }
  } catch (e) {
    // Not all networks may have canonical entry initialized; continue to creation path if allowed
    log("Canonical lookup skipped:", (e as Error).message);
  }

  // 3) Create wrapper if allowed
  if (process.env.CREATE_WRAPPER !== "true") {
    throw new Error("Wrapper not found. Set CREATE_WRAPPER=true to create it on this network.");
  }

  // Use simulate->write to capture return value (wrapper address) reliably.
  // Upgradability: 1 = SEMI_UPGRADABLE (per SuperTokenFactory.Upgradability enum)
  const upgradability = 1;
  const { request, result: createdAddress } = await factory.simulate.createERC20Wrapper([
    underlying,
    cfg.underlyingDecimals,
    upgradability,
    cfg.wrapperName,
    cfg.wrapperSymbol,
  ], { account: account as any });

  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log("createERC20Wrapper tx mined:", receipt.transactionHash);

  const wrapperAddress = createdAddress as unknown as `0x${string}`;
  if (!await isValidWrapper(wrapperAddress)) {
    throw new Error(`Wrapper created but validation failed: ${wrapperAddress}`);
  }

  const block = await publicClient.getBlockNumber();
  await writeJson(deploymentsPath, { address: wrapperAddress, underlying, createdAt: Number(block), chainId, factory: cfg.superTokenFactory });
  log("Wrapper created:", wrapperAddress);
  console.log(wrapperAddress);
}

main().catch((err) => {
  console.error("[wrapper] Error:", err);
  process.exit(1);
});

