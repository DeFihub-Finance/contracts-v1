// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ZapManager} from  "../zap/ZapManager.sol";
import {ICall} from  "../interfaces/ICall.sol";

abstract contract UseZap is ICall, Initializable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    ZapManager public zapManager;
    mapping(address => uint) private _dust;

    event DustCreated(address token, address from, uint amount);
    event DustCollected(address token, address to, uint amount);

    function __UseZap_init(
        ZapManager _zapManager
    ) internal onlyInitializing {
        zapManager = _zapManager;
    }

    /**
     * @param _swapOrZap - Encoded version of ZapManager.ProtocolCall
     * @param _inputToken - Token to be sold
     * @param _outputToken - Token to be bought
     * @param _amount - Amount of input tokens to be sold
     * @return Amount of output tokens bought. If no zap is needed, returns input token amount
     */
    function _zap(
        bytes memory _swapOrZap,
        IERC20Upgradeable _inputToken,
        IERC20Upgradeable _outputToken,
        uint _amount
    ) internal virtual returns (uint) {
        if (_swapOrZap.length > 1 && _inputToken != _outputToken) {
            _inputToken.safeTransfer(address(zapManager), _amount);

            uint initialBalance = _outputToken.balanceOf(address(this));

            (bool success, bytes memory data) = address(zapManager).call(_swapOrZap);

            if (!success)
                revert LowLevelCallFailed(address(zapManager), _swapOrZap, data);

            return _outputToken.balanceOf(address(this)) - initialBalance;
        }

        return _amount;
    }

    function _updateDust(
        IERC20Upgradeable _token,
        uint _initialBalance
    ) internal virtual {
        uint transactionDust = _token.balanceOf(address(this)) - _initialBalance;

        if (transactionDust > 0) {
            _dust[address(_token)] += transactionDust;
            emit DustCreated(address(_token), msg.sender, transactionDust);
        }
    }

    function _collectDust(IERC20Upgradeable _token, address _to) internal virtual {
        uint collectAmount = _dust[address(_token)];

        _dust[address(_token)] = 0;
        _token.safeTransfer(_to, collectAmount);

        emit DustCollected(address(_token), msg.sender, collectAmount);
    }

    function dust(address _token) external view returns (uint) {
        return _dust[_token];
    }
}
