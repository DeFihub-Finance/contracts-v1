// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    uint8 private _decimals;

    constructor(
        uint8 decimals_
    ) ERC20("ERC20", "ERC20") {
        _decimals = decimals_;
    }

    function mint(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}

contract TestERC20Named is ERC20 {
    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {
    }

    function mint(address _to, uint256 _amount) public {
        _mint(_to, _amount);
    }
}
