// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IERC20Mintable {
    function mint(address _to, uint _amount) external;
}

contract TestRouter {
    function getAmountsOut(uint _amount, address[] calldata _path) external pure returns (uint[] memory amountsOut) {
        amountsOut = new uint[](_path.length);

        for (uint i = 0; i < _path.length - 1; i++) {
            amountsOut[i] = 0;
        }

        amountsOut[_path.length - 1] = _amount - _amount * 5 / 100;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint _amountIn,
        uint _amountOutMin,
        address[] calldata _path,
        address _to,
        uint
    ) external {
        IERC20(_path[0]).transferFrom(msg.sender, address(this), _amountIn);
        IERC20Mintable(_path[_path.length - 1]).mint(_to, _amountOutMin);
    }
}
