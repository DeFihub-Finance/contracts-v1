// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IBeefyVaultV7 is IERC20Upgradeable {
    function want() external view returns (IERC20Upgradeable);

    function balance() external view returns (uint);

    function available() external view returns (uint256);

    function getPricePerFullShare() external view returns (uint256);

    function depositAll() external;

    function deposit(uint _amount) external;

    function earn() external;

    function withdrawAll() external;

    function withdraw(uint256 _shares) external;
}
