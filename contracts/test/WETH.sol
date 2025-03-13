// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.26;

import {TestERC20} from "./ERC20.sol";

contract TestWETH is TestERC20 {
    constructor() TestERC20(18) {}

    function deposit() external payable {
        depositTo(msg.sender);
    }

    function withdraw(uint256 amount) external {
        withdrawTo(msg.sender, amount);
    }

    function depositTo(address account) public payable {
        _mint(account, msg.value);
    }

    function withdrawTo(address account, uint256 amount) public {
        _burn(msg.sender, amount);
        (bool success, ) = account.call{ value: amount }("");
        require(success, "FAIL_TRANSFER");
    }

    receive() external payable {
        depositTo(msg.sender);
    }
}
