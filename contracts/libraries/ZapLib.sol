// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ZapManager} from "../zap/ZapManager.sol";

library ZapLib {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    function _zap(
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
