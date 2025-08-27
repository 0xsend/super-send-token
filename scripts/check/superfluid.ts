import hre from "hardhat";
import { getConfig } from "../../config/superfluid";

async function main() {
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const cfg = getConfig(chainId);

  const addrs = [
    { name: "Resolver", addr: cfg.resolver },
    { name: "Host", addr: cfg.host },
    { name: "CFAv1", addr: cfg.cfaV1 },
    { name: "SuperTokenFactory", addr: cfg.superTokenFactory },
  ];

  console.log(`Network chainId=${chainId}`);
  for (const { name, addr } of addrs) {
    const code = await publicClient.getBytecode({ address: addr });
    console.log(`${name} @ ${addr} -> bytecode: ${code ? code.length : 0}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

