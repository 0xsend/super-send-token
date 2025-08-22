import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks: {
    // base mainnet network
    hardhat: {
      chainId: 8453,
      forking: {
        url: "https://mainnet.base.org",
      },
    },
    anvil: {
      url: "http://127.0.0.1:8546",
      chainId: 845337,
    },
    sepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: [process.env.EOA_DEPLOYER!],
    },
    base: {
      url: "https://mainnet.base.org",
      chainId: 8453,
      accounts: [process.env.EOA_DEPLOYER!],
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
