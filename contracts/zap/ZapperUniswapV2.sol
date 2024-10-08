// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IZapper} from "./IZapper.sol";
import {Swapper} from "./Swapper.sol";
import {UseDust} from "../abstract/UseDust.sol";

contract ZapperUniswapV2 is IZapper, Swapper, UseDust {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public immutable treasury;

    struct ConstructorParams {
        address treasury;
        address swapRouter;
    }

    struct ZapData {
        uint amountIn;
        address tokenA;
        address tokenB;
        bytes swapA;
        bytes swapB;
        uint amountAMin;
        uint amountBMin;
    }

    constructor(ConstructorParams memory _constructorParams) {
        treasury = _constructorParams.treasury;
        swapRouter = _constructorParams.swapRouter;
    }

    /**
     * @dev supports swapExactTokensForTokens and swapTokensForExactTokens
     * @dev "swapA" and "swapB" must include the signature and data of the desired router function
     *
     * @param data bytes argument is an encoded version of the ZapData struct
     */
    function zap(bytes memory data) external {
        ZapData memory zapData = abi.decode(data, (ZapData));
        IERC20Upgradeable tokenA = IERC20Upgradeable(zapData.tokenA);
        IERC20Upgradeable tokenB = IERC20Upgradeable(zapData.tokenB);
        uint amountInPerSwap = zapData.amountIn / 2;

        if (zapData.swapA.length > 0) {
            if (tokenA.allowance(address(this), swapRouter) < amountInPerSwap)
                tokenA.safeApprove(swapRouter, type(uint).max);

            swap(zapData.swapA);
        }

        if (zapData.swapB.length > 0) {
            if (tokenB.allowance(address(this), swapRouter) < amountInPerSwap)
                tokenB.safeApprove(swapRouter, type(uint).max);

            swap(zapData.swapB);
        }

        IUniswapV2Router02(swapRouter).addLiquidity(
            zapData.tokenA,
            zapData.tokenB,
            IERC20Upgradeable(zapData.tokenA).balanceOf(address(this)),
            IERC20Upgradeable(zapData.tokenB).balanceOf(address(this)),
            zapData.amountAMin,
            zapData.amountBMin,
            msg.sender,
            block.timestamp
        );

        _sendDust(tokenA, treasury);
        _sendDust(tokenB, treasury);

        emit Zapped(swapRouter, data);
    }
}
