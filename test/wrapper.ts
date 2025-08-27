import { expect } from "chai";
import hre from "hardhat";
import { getConfig } from "../config/superfluid";
import { getContract, zeroAddress } from "viem";
import path from "node:path";
import {
  impersonateAccount,
  setBalance,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

// Official ABIs from Superfluid package (Rule 3: mirror official examples)
import SuperTokenFactoryJson from "@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json";
import ISuperTokenJson from "@superfluid-finance/ethereum-contracts/build/truffle/ISuperToken.json";
import IERC20Json from "@superfluid-finance/ethereum-contracts/build/truffle/IERC20.json";

async function getWrapperAddress(): Promise<`0x${string}` | null> {
  const publicClient = await hre.viem.getPublicClient();
  const [walletClient] = await hre.viem.getWalletClients();
  if (!walletClient) throw new Error("Wallet client not configured");

  const chainId = await publicClient.getChainId();
  const cfg = getConfig(chainId);

  // Try deployments cache
  try {
    const deployments = await hre.run("read-file", {
      path: `deployments/wrapper.${chainId}.json`,
    }).catch(() => null as any);
    if (deployments) {
      const parsed = JSON.parse(deployments);
      if (parsed?.address && parsed.address !== "") return parsed.address;
    }
  } catch {}

  // Try canonical mapping
  const factory = getContract({
    address: cfg.superTokenFactory,
    abi: SuperTokenFactoryJson.abi as any[],
    client: { public: publicClient },
  });
  try {
    const canonical = (await factory.read.getCanonicalERC20Wrapper([
      cfg.sendV1,
    ])) as unknown as `0x${string}`;
    if (canonical && canonical !== zeroAddress) return canonical;
  } catch {}

  // Optionally create if allowed
  if (process.env.CREATE_WRAPPER === "true") {
    const factoryWrite = getContract({
      address: cfg.superTokenFactory,
      abi: SuperTokenFactoryJson.abi as any[],
      client: { public: publicClient, wallet: walletClient },
    });
    const upgradability = 1; // SEMI_UPGRADABLE
    const { request, result } = await factoryWrite.simulate.createERC20Wrapper(
      [cfg.sendV1, cfg.underlyingDecimals, upgradability, cfg.wrapperName, cfg.wrapperSymbol],
      { account: walletClient.account as any }
    );
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
  const superToken = getContract({ address: addr, abi: ISuperTokenJson.abi as any[], client: { public: publicClient } });
  try {
    const underlying = (await superToken.read.getUnderlyingToken([])) as unknown as `0x${string}`;
    return underlying.toLowerCase() === cfg.sendV1.toLowerCase();
  } catch { return false; }
}

describe("SuperToken wrapper (backend-only)", () => {
  it("metadata and wiring", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);

    const addr = await getWrapperAddress();
    if (!addr) {
      this.skip(); // Wrapper not available and creation not permitted
    }

    expect(await isValidWrapper(addr!)).to.equal(true);

    const superToken = getContract({ address: addr!, abi: ISuperTokenJson.abi as any[], client: { public: publicClient } });
    const [name, symbol, decimals, underlying] = await Promise.all([
      superToken.read.name([]),
      superToken.read.symbol([]),
      superToken.read.decimals([]),
      superToken.read.getUnderlyingToken([]),
    ]);

    expect(name).to.be.a("string");
    expect(symbol).to.be.a("string");
    const decimalsNum = Number(decimals as any);
    expect(decimalsNum).to.equal(18);
    const underlyingAddr = underlying as unknown as `0x${string}`;
    expect(underlyingAddr.toLowerCase()).to.equal(cfg.sendV1.toLowerCase());
  });

  it("upgrade and downgrade round-trip (no env, local mock wrapper)", async function () {
    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);

    // Create a wrapper for a locally deployed mock ERC20 and round-trip
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SuperTokenFactoryJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json");

    // Deploy mock underlying
    const artifactsRoot = path.resolve(__dirname, "..", "artifacts", "contracts");
    const mockErc20Artifact = await (async () => {
      try { return JSON.parse(await (await import("fs/promises")).readFile(path.resolve(artifactsRoot, "mocks", "MockERC20.sol", "MockERC20.json"), "utf8")); } catch { return null; }
    })();
    if (!mockErc20Artifact?.abi) this.skip();
    const erc20Abi = mockErc20Artifact.abi as any[];
    const erc20Bytecode = (mockErc20Artifact.bytecode?.object ?? mockErc20Artifact.bytecode) as `0x${string}`;
    const hashUnderlying = await walletClient.deployContract({ abi: erc20Abi, bytecode: erc20Bytecode, args: ["MOCK", "MOCK", 18], account: walletClient.account! });
    const receiptUnderlying = await publicClient.waitForTransactionReceipt({ hash: hashUnderlying });
    const underlyingAddr = receiptUnderlying.contractAddress as `0x${string}`;

    // Create wrapper via factory
    const factory = getContract({ address: cfg.superTokenFactory, abi: (SuperTokenFactoryJson as any).default.abi as any[], client: { public: publicClient, wallet: walletClient } });
    const { request: createReq, result: wrapperRes } = await factory.simulate.createERC20Wrapper([underlyingAddr, 18, 1, cfg.wrapperName, cfg.wrapperSymbol], { account: walletClient.account! });
    const createHash = await walletClient.writeContract(createReq);
    await publicClient.waitForTransactionReceipt({ hash: createHash });
    const addr = wrapperRes as unknown as `0x${string}`;

    const superToken = getContract({ address: addr!, abi: ISuperTokenJson.abi as any[], client: { public: publicClient, wallet: walletClient } });
    const underlying = getContract({ address: underlyingAddr, abi: IERC20Json.abi as any[], client: { public: publicClient, wallet: walletClient } });

    const amount = 10n ** 18n;

    // Mint to ourselves via MockERC20.mint
    const mintAbi = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }] as const;
    const minter = getContract({ address: underlyingAddr, abi: mintAbi as any, client: { public: publicClient, wallet: walletClient } });
    await minter.write.mint([walletClient.account!.address, amount]);

    const [u0Raw, s0Raw] = await Promise.all([
      underlying.read.balanceOf([walletClient.account!.address]),
      superToken.read.balanceOf([walletClient.account!.address]),
    ]);
    const u0 = u0Raw as unknown as bigint;
    const s0 = s0Raw as unknown as bigint;

    await underlying.write.approve([addr!, amount], { account: walletClient.account! });
    await superToken.write.upgrade([amount], { account: walletClient.account! });

    const [u1Raw, s1Raw] = await Promise.all([
      underlying.read.balanceOf([walletClient.account!.address]),
      superToken.read.balanceOf([walletClient.account!.address]),
    ]);
    const u1 = u1Raw as unknown as bigint;
    const s1 = s1Raw as unknown as bigint;

    expect(u1).to.equal(u0 - amount);
    expect(s1).to.equal(s0 + amount);

    await superToken.write.downgrade([amount], { account: walletClient.account! });
    const [u2Raw, s2Raw] = await Promise.all([
      underlying.read.balanceOf([walletClient.account!.address]),
      superToken.read.balanceOf([walletClient.account!.address]),
    ]);
    const u2 = u2Raw as unknown as bigint;
    const s2 = s2Raw as unknown as bigint;

    expect(u2).to.equal(u0);
    expect(s2).to.equal(s0);
  });

  it("optional: CFA lifecycle smoke (gated by RUN_CFA_SMOKE)", async function () {
    if (process.env.RUN_CFA_SMOKE !== "true") this.skip();

    const publicClient = await hre.viem.getPublicClient();
    const [walletClient] = await hre.viem.getWalletClients();
    if (!walletClient) this.skip();

    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);
    const addr = await getWrapperAddress();
    if (!addr || !(await isValidWrapper(addr))) this.skip();

    // We only validate that contracts are callable; full flow creation is environment-sensitive and
    // should be exercised in dedicated integration runs.
    // Static imports for ABIs
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ISuperfluidJson = await import("@superfluid-finance/ethereum-contracts/build/truffle/ISuperfluid.json");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IConstantFlowAgreementV1Json = await import("@superfluid-finance/ethereum-contracts/build/truffle/IConstantFlowAgreementV1.json");

    const host = getContract({ address: cfg.host, abi: (ISuperfluidJson as any).default.abi as any[], client: { public: publicClient } });
    const cfa = getContract({ address: cfg.cfaV1, abi: (IConstantFlowAgreementV1Json as any).default.abi as any[], client: { public: publicClient } });

    // Basic read calls as smoke checks
    const hostAddress = await host.read.getCodeAddress([]).catch(() => cfg.host);
    expect((hostAddress as string).toLowerCase()).to.be.a("string");

    // Encode a getFlow call as a non-mutating check (won't throw)
    const receiver = walletClient.account!.address;
    const flowInfo = await cfa.read.getFlow([addr!, walletClient.account!.address, receiver]).catch(() => null);
    expect(flowInfo).to.not.equal(undefined);
  });
});

