// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/*
 
    ███████╗███████╗███╗   ██╗██████╗     ██╗████████╗
    ██╔════╝██╔════╝████╗  ██║██╔══██╗    ██║╚══██╔══╝
    ███████╗█████╗  ██╔██╗ ██║██║  ██║    ██║   ██║
    ╚════██║██╔══╝  ██║╚██╗██║██║  ██║    ██║   ██║
    ███████║███████╗██║ ╚████║██████╔╝    ██║   ██║
    ╚══════╝╚══════╝╚═╝  ╚═══╝╚═════╝     ╚═╝   ╚═╝

*/
contract SendToken is ERC20Burnable {
    address public immutable lockbox;

    constructor(
        string memory _name,
        string memory _symbol,
        address _lockbox
    ) ERC20(_name, _symbol) {
        require(_lockbox != address(0), "ZL");
        lockbox = _lockbox;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == lockbox, "NL");
        _mint(to, amount);
    }
}
