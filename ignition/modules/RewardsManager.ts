import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const RewardsManagerModule = buildModule("RewardsManagerModule", (m) => {
  const sendx = m.getParameter<`0x${string}`>("sendx");
  const sendEarnFactory = m.getParameter<`0x${string}`>("sendEarnFactory");
  const asset = m.getParameter<`0x${string}`>("asset");
  const admin = m.getParameter<`0x${string}`>("admin");
  const minAssets = m.getParameter<bigint>("minAssets");

  const rewardsManager = m.contract("RewardsManager", [sendx, sendEarnFactory, asset, admin, minAssets]);

  return { rewardsManager };
});

export default RewardsManagerModule;
