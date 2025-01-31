// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IUniversalRouter} from "../interfaces/IUniversalRouter.sol";

library HubRouter {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    error InvalidSwap();

    struct SwapData {
        IUniversalRouter router;
        bytes commands;
        bytes[] inputs;
    }

    /**
     * @notice Performs a zap operation using the specified protocol call data.
     * @param _encodedSwapData - Encoded version of `SwapData`
     * @param _inputToken The ERC20 token to be sold.
     * @param _outputToken The ERC20 token to be bought.
     * @param _amount - Amount of input tokens to be sold
     * @return outputAmount - The amount of output tokens bought. If no zap is needed, returns the input token amount.
     */
    function execute(
        bytes memory _encodedSwapData,
        IERC20Upgradeable _inputToken,
        IERC20Upgradeable _outputToken,
        uint _amount
    ) internal returns (uint outputAmount) {
        if (_encodedSwapData.length == 0) {
            if (_inputToken == _outputToken || _amount == 0)
                return _amount;
            else
                revert InvalidSwap();
        }

        uint initialOutputBalance = _outputToken.balanceOf(address(this));

        SwapData memory swapData = _decodeSwapData(_encodedSwapData);

        _inputToken.safeTransfer(address(swapData.router), _amount);

        swapData.router.execute(swapData.commands, swapData.inputs);

        return _outputToken.balanceOf(address(this)) - initialOutputBalance;
    }

    /**
     * @notice Performs a zap operation using the specified protocol call data.
     * @param _encodedSwapData - Encoded version of `SwapData`. Must include UNWRAP_WETH command.
     * @param _outputToken The ERC20 token to be bought.
     * @return outputAmount - The amount of output tokens bought. If no zap is needed, returns the input token amount.
     */
    function executeNative(
        bytes memory _encodedSwapData,
        IERC20Upgradeable _outputToken
    ) internal returns (uint outputAmount) {
        if (_encodedSwapData.length == 0)
            revert InvalidSwap();

        uint initialOutputBalance = _outputToken.balanceOf(address(this));

        SwapData memory swapData = _decodeSwapData(_encodedSwapData);

        swapData.router.execute{value: msg.value}(swapData.commands, swapData.inputs);

        return _outputToken.balanceOf(address(this)) - initialOutputBalance;
    }

    function _decodeSwapData(bytes memory _encodedSwapData) internal pure returns (SwapData memory) {
        return abi.decode(_encodedSwapData, (SwapData));
    }
}
