import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const SendEarnRewardsModule = buildModule("SendEarnRewardsModule", (m) => {
  const sendx = m.getParameter<`0x${string}`>("sendx");
  const sendEarnFactory = m.getParameter<`0x${string}`>("sendEarnFactory");
  const asset = m.getParameter<`0x${string}`>("asset");
  const admin = m.getParameter<`0x${string}`>("admin");
  const name = m.getParameter<string>("name", "Send Earn Rewards");
  const symbol = m.getParameter<string>("symbol", "sREW");

  const sendEarnRewards = m.contract("SendEarnRewards", [sendx, sendEarnFactory, asset, name, symbol, admin]);

  return { sendEarnRewards };
});

export default SendEarnRewardsModule;
