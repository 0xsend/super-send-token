// This setup uses Hardhat Ignition to manage smart contract deployments.
// Learn more about it at https://hardhat.org/ignition

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const TOKEN_NAME = "Send";
const TOKEN_SYMBOL = "SEND";

/// @dev Lockbox address is pre-calculated
const LOCKBOX_ADDRESS = "0x60E5445EDc1A469CFc0181861c88BD4B6895F615";

/// @dev SendV0 address on Base chain
const SEND_V0 = "0x3f14920c99beb920afa163031c4e47a3e03b3e4a";

/// @dev Make sure we are using deployed that pre-calculated the lockbox address
export const EOA_DEPLOYER = "0x7F314BffCB437b7046F469dE2457f9C4014931e1";

const SendTokenModule = buildModule("SendTokenModule", (m) => {
  const sendToken = m.contract(
    "SendToken",
    [TOKEN_NAME, TOKEN_SYMBOL, LOCKBOX_ADDRESS],
    {
      from: EOA_DEPLOYER,
    }
  );

  const sendLockbox = m.contract("SendLockbox", [SEND_V0, sendToken], {
    from: EOA_DEPLOYER,
  });

  return { sendToken, sendLockbox };
});

export default SendTokenModule;
