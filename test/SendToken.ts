import {
  loadFixture,
  impersonateAccount,
  setBalance,
  reset,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre, { ignition } from "hardhat";
import { parseEther } from "viem";
import SendTokenModule, { EOA_DEPLOYER } from "../ignition/modules/SendToken";

/// @dev We use treasury to test the migration
const TREASURY_ADDRESS = "0x05CEa6C36f3a44944A4F4bA39B1820677AcB97EE";

describe("SendToken", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployToken() {
    /// @dev we reset the network to make sure we are testing prior to mainnet deployment
    await reset(hre.config.networks.hardhat.forking?.url, 24820325);
    await impersonateAccount(EOA_DEPLOYER);
    await setBalance(EOA_DEPLOYER, parseEther("1"));

    const { sendToken, sendLockbox } = await ignition.deploy(SendTokenModule);

    return {
      sendToken,
      sendLockbox,
    };
  }

  it("Should match the meta", async function () {
    const { sendToken, sendLockbox } = await loadFixture(deployToken);

    /// @dev Make sure the addresses are correct
    expect(sendToken.address).to.equal(
      "0xEab49138BA2Ea6dd776220fE26b7b8E446638956"
    );
    expect(sendLockbox.address).to.equal(
      "0x60E5445EDc1A469CFc0181861c88BD4B6895F615"
    );

    expect(await sendToken.read.name()).to.equal("Send");
    expect(await sendToken.read.symbol()).to.equal("SEND");
    expect(await sendToken.read.decimals()).to.equal(18);
  });

  it("Should convert 100 SENDv0 to 1e18 SENDv1", async function () {
    const { sendToken, sendLockbox } = await loadFixture(deployToken);

    // impersonate treasury address and approve lockbox contract
    await impersonateAccount(TREASURY_ADDRESS);
    await setBalance(TREASURY_ADDRESS, parseEther("1"));

    const oldToken = await hre.viem.getContractAt(
      "IERC20",
      "0x3f14920c99beb920afa163031c4e47a3e03b3e4a"
    );

    // approve lockbox contract
    await oldToken.write.approve([sendLockbox.address, 100n], {
      account: TREASURY_ADDRESS,
    });

    // deposit 100 tokens
    await sendLockbox.write.deposit([100n], {
      account: TREASURY_ADDRESS,
    });

    // there should be 100 SEND V0 in the lockbox
    expect(await oldToken.read.balanceOf([sendLockbox.address])).to.equal(100n);

    // there should be 1 minted SEND with 18 decimals (1 ether)
    expect(await sendToken.read.balanceOf([TREASURY_ADDRESS])).to.equal(
      parseEther("1")
    );
  });
});
