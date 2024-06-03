// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {IUniswapV2Router02} from "../interfaces/IUniswapV2Router02.sol";
import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

library ExtendedRouter {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    function swap(
        IUniswapV2Router02 _router,
        uint _amountIn,
        uint _amountOutMin,
        address[] memory _path
    ) internal returns (uint) {
        _approveSpend(_path[0], address(_router), _amountIn);

        uint output = _router.getAmountsOut(_amountIn, _path)[_path.length - 1];

        _router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            _amountIn,
            _amountOutMin,
            _path,
            address(this),
            block.timestamp
        );

        return output;
    }

    function _approveSpend(
        address _token,
        address _spender,
        uint _amount
    ) private {
        IERC20Upgradeable(_token).safeIncreaseAllowance(_spender, _amount);
    }
}
