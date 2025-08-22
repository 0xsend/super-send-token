// Per-network Superfluid + SEND v1 config (no custom Solidity). Mirrors official addresses provided in the handoff.
// Rule 3: this is a simple address map used by scripts/tests; wrapper creation logic will mirror
// SuperTokenFactory + ISuperToken official references.

export type NetworkConfig = {
  chainId: number;
  name: string;
  sendV1: `0x${string}`;
  resolver: `0x${string}`;
  host: `0x${string}`;
  cfaV1: `0x${string}`;
  superTokenFactory: `0x${string}`;
  wrapperName: string;
  wrapperSymbol: string;
  underlyingDecimals: number;
};

export const CONFIG: Record<number, NetworkConfig> = {
  8453: {
    chainId: 8453,
    name: "base-mainnet",
    sendV1: "0xEab49138BA2Ea6dd776220fE26b7b8E446638956",
    resolver: "0x6a214c324553F96F04eFBDd66908685525Da0E0d",
    host: "0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74",
    cfaV1: "0x19ba78B9cDB05A877718841c574325fdB53601bb",
    superTokenFactory: "0xe20B9a38E0c96F61d1bA6b42a61512D56Fea1Eb3",
    wrapperName: "Super Send",
    wrapperSymbol: "SENDx",
    underlyingDecimals: 18,
  },
  84532: {
    chainId: 84532,
    name: "base-sepolia",
    sendV1: "0xBbB542c66a7DD7BA6893C9630B30358D610FF3ee",
    resolver: "0x21d4E9fbB9DB742E6ef4f29d189a7C18B0b59136",
    host: "0x109412E3C84f0539b43d39dB691B08c90f58dC7c",
    cfaV1: "0x6836F23d6171D74Ef62FcF776655aBcD2bcd62Ef",
    superTokenFactory: "0x7447E94Dfe3d804a9f46Bf12838d467c912C8F6C",
    wrapperName: "Super Send",
    wrapperSymbol: "SENDx",
    underlyingDecimals: 18,
  },
  845337: {
    chainId: 845337,
    name: "local-base-mainnet-fork",
    // Local fork uses the mainnet address for the underlying
    sendV1: "0xEab49138BA2Ea6dd776220fE26b7b8E446638956",
    // Superfluid contracts are not deployed on the fork by default; scripts/tests can refer to
    // mainnet addresses against the fork RPC.
    resolver: "0x6a214c324553F96F04eFBDd66908685525Da0E0d",
    host: "0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74",
    cfaV1: "0x19ba78B9cDB05A877718841c574325fdB53601bb",
    superTokenFactory: "0xe20B9a38E0c96F61d1bA6b42a61512D56Fea1Eb3",
    wrapperName: "Super Send",
    wrapperSymbol: "SENDx",
    underlyingDecimals: 18,
  },
};

export function getConfig(chainId: number): NetworkConfig {
  const c = CONFIG[chainId];
  if (!c) throw new Error(`Unsupported chainId: ${chainId}`);
  return c;
}

