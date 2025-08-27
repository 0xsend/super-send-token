import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import dotenv from "dotenv";

dotenv.config();

const BASE_RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const BASE_FORK_BLOCK = process.env.BASE_FORK_BLOCK
  ? Number(process.env.BASE_FORK_BLOCK)
  : undefined;

const DEPLOYER = process.env.EOA_DEPLOYER;

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks: {
    // Base mainnet fork as default local network
    hardhat: {
      chainId: 8453,
      hardfork: "cancun",
      forking: {
        url: BASE_RPC,
        // Pin a block for stability when provided
        blockNumber: BASE_FORK_BLOCK,
      },
    },
    anvil: {
      url: "http://127.0.0.1:8546",
      chainId: 845337,
      accounts: DEPLOYER ? [DEPLOYER] : undefined,
    },
    sepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      // Optional: only include account if provided to avoid HH8 when unset
      accounts: DEPLOYER ? [DEPLOYER] : [],
    },
    base: {
      url: "https://mainnet.base.org",
      chainId: 8453,
      // Optional: only include account if provided to avoid HH8 when unset
      accounts: DEPLOYER ? [DEPLOYER] : [],
    },
  },
  etherscan: {
    apiKey: {
      base: process.env.ETHERSCAN_API_KEY!,
      sepolia: process.env.ETHERSCAN_API_KEY!,
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

export default config;
