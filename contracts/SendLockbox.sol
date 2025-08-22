// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./ISendToken.sol";
import "./ISendLockbox.sol";

contract SendLockbox is ISendLockbox {
    using SafeERC20 for IERC20;

    /// @notice The old ERC20 token of this contract
    IERC20 public immutable SEND_V0;

    /// @notice The new ERC20 token of this contract
    ISendToken public immutable SEND_V1;

    /// @param sendv0 The address of the old ERC20 contract
    /// @param sendv1 The address of the new ERC20 contract
    constructor(address sendv0, address sendv1) {
        SEND_V0 = IERC20(sendv0);
        SEND_V1 = ISendToken(sendv1);
    }

    /// @notice Deposit tokens into the lockbox and mints the new token to sender
    /// @param amount The amount of tokens to deposit
    function deposit(uint256 amount) external {
        _deposit(msg.sender, amount);
    }

    /// @notice Deposit ERC20 tokens into the lockbox
    /// @param to The user who should received minted tokens
    /// @param amount The amount of tokens to deposit
    function depositTo(address to, uint256 amount) external {
        _deposit(to, amount);
    }

    /// @notice Deposit tokens into the lockbox
    /// @param to The user who should received minted tokens
    /// @param amount The amount of tokens to deposit
    function _deposit(address to, uint256 amount) internal {
        SEND_V0.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(to, amount);

        /// @notice v0 token has 0 decimals, v1 token has 18 decimals, therefore we multiply by 1 ether
        /// @notice v0 token has 100B supply, v1 token has 1B supply, therefore divided by 100
        uint256 amountToMint = (amount * 1 ether) / 100;
        SEND_V1.mint(to, amountToMint);
    }
}
