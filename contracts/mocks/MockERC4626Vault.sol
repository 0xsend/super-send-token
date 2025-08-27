// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC4626Minimal {
    function asset() external view returns (address);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract MockERC4626Vault is IERC4626Minimal {
    address public immutable override asset;

    string public name;
    string public symbol;

    mapping(address => uint256) public override balanceOf;

    // ratio numerator/denominator for shares->assets conversion
    uint256 public immutable ratioNum;
    uint256 public immutable ratioDen;

    constructor(address _asset, string memory _name, string memory _symbol, uint256 _ratioNum, uint256 _ratioDen) {
        require(_asset != address(0), "asset");
        require(_ratioNum > 0 && _ratioDen > 0, "ratio");
        asset = _asset;
        name = _name;
        symbol = _symbol;
        ratioNum = _ratioNum;
        ratioDen = _ratioDen;
    }

    function mint(address to, uint256 shares) external {
        balanceOf[to] += shares;
    }

    function convertToAssets(uint256 shares) external view override returns (uint256) {
        return shares * ratioNum / ratioDen;
    }
}

