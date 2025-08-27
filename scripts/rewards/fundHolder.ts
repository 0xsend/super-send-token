import hre from "hardhat";
import { encodeFunctionData } from "viem";

// Quick helper to fund a holder with ERC-4626 shares by depositing underlying assets.
// Works best on a local Hardhat/Anvil network.
//
// Required env:
// - VAULT_ADDRESS: 0x... (ERC-4626 vault) [preferred]
//   or SHARE_TOKEN_ADDRESS (deprecated name, still supported for compatibility)
// - SHARE_HOLDER:       0x... (address to receive shares)
// - AMOUNT_ASSETS:      raw units of underlying to deposit (e.g., 1000000 for 1.0 if 6 decimals)
//
// Optional env:
// - ASSET_ADDRESS:      0x... (underlying token). If not set, derived via IERC4626.asset().
// - ASSET_SOURCE:       0x... (address holding underlying to fund the holder). If not set, assumes holder already has funds.
//
// Usage:
//   SHARE_TOKEN_ADDRESS=0xVault SHARE_HOLDER=0xHolder AMOUNT_ASSETS=1000000 \
//   bunx hardhat run scripts/rewards/fundHolder.ts --network anvil
//
// If you need to source funds on a fork:
//   ASSET_SOURCE=0xWhaleAddress ... (the script will impersonate and transfer)

const ERC20_ABI = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [
    { name: "to", type: "address" }, { name: "amount", type: "uint256" }
  ], outputs: [{ type: "bool" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" }, { name: "amount", type: "uint256" }
  ], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [
    { name: "account", type: "address" }
  ], outputs: [{ type: "uint256" }] },
] as const;

const IERC4626_ABI = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [
    { name: "assets", type: "uint256" }, { name: "receiver", type: "address" }
  ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "convertToAssets", stateMutability: "view", inputs: [
    { name: "shares", type: "uint256" }
  ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [
    { name: "account", type: "address" }
  ], outputs: [{ type: "uint256" }] },
] as const;

function toHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

async function sendTx(from: `0x${string}`, to: `0x${string}`, data: `0x${string}`, value: bigint = 0n) {
  const provider = hre.network.provider;
  // ensure the impersonated account has ETH for gas
  await provider.request({ method: "hardhat_setBalance", params: [from, toHex(10n * 10n ** 18n)] });
  await provider.request({ method: "hardhat_impersonateAccount", params: [from] });
  try {
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data, value: toHex(value) }],
    });
    await hre.viem.getPublicClient().then((pc) => pc.waitForTransactionReceipt({ hash: txHash as `0x${string}` }));
  } finally {
    await provider.request({ method: "hardhat_stopImpersonatingAccount", params: [from] });
  }
}

async function main() {
  const publicClient = await hre.viem.getPublicClient();

const VAULT = (process.env.VAULT_ADDRESS as `0x${string}` | undefined) || (process.env.SHARE_TOKEN_ADDRESS as `0x${string}` | undefined);
  const HOLDER = process.env.SHARE_HOLDER as `0x${string}` | undefined;
  const AMOUNT_ASSETS_STR = process.env.AMOUNT_ASSETS as string | undefined;
  if (!VAULT || !HOLDER || !AMOUNT_ASSETS_STR) {
    throw new Error("Missing SHARE_TOKEN_ADDRESS, SHARE_HOLDER, or AMOUNT_ASSETS env vars");
  }
  const AMOUNT_ASSETS = BigInt(AMOUNT_ASSETS_STR);

  let ASSET = process.env.ASSET_ADDRESS as `0x${string}` | undefined;
  if (!ASSET) {
    // read IERC4626.asset()
    const data = encodeFunctionData({ abi: IERC4626_ABI, functionName: "asset", args: [] });
    const res = await publicClient.call({ to: VAULT, data });
    if (!res.data) throw new Error("IERC4626.asset() returned no data");
    // address is 32 bytes right-aligned; viem returns as hex string; cast to 20-byte address
    ASSET = (`0x${res.data.slice(26)}`) as `0x${string}`; // trim 12 bytes (24 hex chars) if needed
  }

  const ASSET_SOURCE = process.env.ASSET_SOURCE as `0x${string}` | undefined;

  // 1) If ASSET_SOURCE provided, transfer underlying to HOLDER
  if (ASSET_SOURCE) {
    const transferData = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [HOLDER, AMOUNT_ASSETS] });
    await sendTx(ASSET_SOURCE, ASSET!, transferData);
  }

  // 2) HOLDER approves and deposits into the vault
  const approveData = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [VAULT, AMOUNT_ASSETS] });
  await sendTx(HOLDER as `0x${string}`, ASSET!, approveData);

  const depositData = encodeFunctionData({ abi: IERC4626_ABI, functionName: "deposit", args: [AMOUNT_ASSETS, HOLDER] });
  await sendTx(HOLDER as `0x${string}`, VAULT, depositData);

  // 3) Report balances
  const balSharesData = encodeFunctionData({ abi: IERC4626_ABI, functionName: "balanceOf", args: [HOLDER] });
  const balSharesRes = await publicClient.call({ to: VAULT, data: balSharesData });
  const shares = balSharesRes.data ? BigInt(balSharesRes.data) : 0n;

  const assetsData = encodeFunctionData({ abi: IERC4626_ABI, functionName: "convertToAssets", args: [shares] });
  const assetsRes = await publicClient.call({ to: VAULT, data: assetsData });
  const assets = assetsRes.data ? BigInt(assetsRes.data) : 0n;

  console.log(JSON.stringify({ vault: VAULT, holder: HOLDER, shares: shares.toString(), assets: assets.toString(), asset: ASSET }, null, 2));
}

main().catch((e) => {
  console.error("[fundHolder] Error:", e);
  process.exit(1);
});

