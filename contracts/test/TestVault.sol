// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestVault is ERC20('TestVault', 'TestVault') {
    IERC20Upgradeable public want;

    constructor(IERC20Upgradeable _want) {
        want = _want;
    }

    function deposit(uint _amount) external {
        want.transferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
    }

    function withdraw(uint _amount) external {
        require(balanceOf(msg.sender) >= _amount, 'TestVault: Insufficient balance');

        want.transfer(msg.sender, _amount);
        _burn(msg.sender, _amount);
    }
}
