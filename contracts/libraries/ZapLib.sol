// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ZapManager} from "../zap/ZapManager.sol";

library ZapLib {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @notice Performs a zap operation using the specified protocol call data.
     * @param _encodedProtocolCall - Encoded version of ZapManager.ProtocolCall
     * @param _inputToken The ERC20 token to be sold.
     * @param _outputToken The ERC20 token to be bought.
     * @param _amount - Amount of input tokens to be sold
     * @return outputAmount - The amount of output tokens bought. If no zap is needed, returns the input token amount.
     */
    function zap(
        ZapManager _zapManager,
        bytes memory _encodedProtocolCall,
        IERC20Upgradeable _inputToken,
        IERC20Upgradeable _outputToken,
        uint _amount
    ) internal returns (uint outputAmount) {
        if (_encodedProtocolCall.length == 0)
            return _amount;

        uint initialOutputBalance = _outputToken.balanceOf(address(this));

        _inputToken.safeTransfer(address(_zapManager), _amount);

        _zapManager.callProtocol(abi.decode(_encodedProtocolCall, (ZapManager.ProtocolCall)));

        return _outputToken.balanceOf(address(this)) - initialOutputBalance;
    }
}
