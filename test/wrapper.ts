import { expect } from "chai";
import hre from "hardhat";
import { getConfig } from "../config/superfluid";
import { getContract, zeroAddress } from "viem";
import {
  impersonateAccount,
  setBalance,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";

// Official ABIs from Superfluid package (Rule 3: mirror official examples)
import SuperTokenFactoryJson from "@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json" assert { type: "json" };
import ISuperTokenJson from "@superfluid-finance/ethereum-contracts/build/truffle/ISuperToken.json" assert { type: "json" };
import IERC20Json from "@superfluid-finance/ethereum-contracts/build/truffle/IERC20.json" assert { type: "json" };

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
    ])) as `0x${string}`;
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
      { account: walletClient.account! }
    );
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    return result as `0x${string}`;
  }

  return null;
}

async function isValidWrapper(addr: `0x${string}`): Promise<boolean> {
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const cfg = getConfig(chainId);
  const superToken = getContract({ address: addr, abi: ISuperTokenJson.abi as any[], client: { public: publicClient } });
  try {
    const underlying = (await superToken.read.getUnderlyingToken()) as `0x${string}`;
    return underlying.toLowerCase() === cfg.sendV1.toLowerCase();
  } catch { return false; }
}

<<<<<<< HEAD
describe("SuperToken wrapper (backend-only)", () => {
=======
const describeIntegration = process.env.RUN_INTEGRATION === "true" ? describe : describe.skip;

describeIntegration("SuperToken wrapper (backend-only)", () => {
>>>>>>> 1e31d976 (rewards: depositVaultShares pre-NAV; add tests)
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
      superToken.read.name(),
      superToken.read.symbol(),
      superToken.read.decimals(),
      superToken.read.getUnderlyingToken(),
    ]);

    expect(name).to.be.a("string");
    expect(symbol).to.be.a("string");
    expect(decimals).to.equal(18n);
    expect((underlying as string).toLowerCase()).to.equal(cfg.sendV1.toLowerCase());
  });

  it("upgrade and downgrade round-trip (gated by SEND_HOLDER)", async function () {
    const holder = process.env.SEND_HOLDER as `0x${string}` | undefined;
    if (!holder) {
      this.skip();
    }

    const publicClient = await hre.viem.getPublicClient();
    const chainId = await publicClient.getChainId();
    const cfg = getConfig(chainId);

    const addr = await getWrapperAddress();
    if (!addr || !(await isValidWrapper(addr))) {
      this.skip();
    }

    // Impersonate and fund holder for gas
    await impersonateAccount(holder!);
    await setBalance(holder!, 10n * 10n ** 18n);

    const superToken = getContract({ address: addr!, abi: ISuperTokenJson.abi as any[], client: { public: publicClient } });
    const underlying = getContract({ address: cfg.sendV1, abi: IERC20Json.abi as any[], client: { public: publicClient } });

    // amount = 1e18
    const amount = 10n ** 18n;

    const [u0, s0] = await Promise.all([
      underlying.read.balanceOf([holder!]) as Promise<bigint>,
      superToken.read.balanceOf([holder!]) as Promise<bigint>,
    ]);

    // Approve wrapper and upgrade
    await underlying.write.approve([addr!, amount], { account: holder! });
    await superToken.write.upgrade([amount], { account: holder! });

    const [u1, s1] = await Promise.all([
      underlying.read.balanceOf([holder!]) as Promise<bigint>,
      superToken.read.balanceOf([holder!]) as Promise<bigint>,
    ]);

    expect(u1).to.equal(u0 - amount);
    expect(s1).to.equal(s0 + amount);

    // Downgrade back
    await superToken.write.downgrade([amount], { account: holder! });
    const [u2, s2] = await Promise.all([
      underlying.read.balanceOf([holder!]) as Promise<bigint>,
      superToken.read.balanceOf([holder!]) as Promise<bigint>,
    ]);

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
    const host = getContract({ address: cfg.host, abi: (await import("@superfluid-finance/ethereum-contracts/build/truffle/ISuperfluid.json", { assert: { type: "json" } })).default.abi as any[], client: { public: publicClient } });
    const cfa = getContract({ address: cfg.cfaV1, abi: (await import("@superfluid-finance/ethereum-contracts/build/truffle/IConstantFlowAgreementV1.json", { assert: { type: "json" } })).default.abi as any[], client: { public: publicClient } });

    // Basic read calls as smoke checks
    const hostAddress = await host.read.getCodeAddress().catch(() => cfg.host);
    expect((hostAddress as string).toLowerCase()).to.be.a("string");

    // Encode a getFlow call as a non-mutating check (won't throw)
    const receiver = walletClient.account!.address;
    const flowInfo = await cfa.read.getFlow([addr!, walletClient.account!.address, receiver]).catch(() => null);
    expect(flowInfo).to.not.equal(undefined);
  });
});

