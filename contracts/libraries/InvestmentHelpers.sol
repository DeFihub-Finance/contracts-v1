// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {DollarCostAverage} from '../DollarCostAverage.sol';
import {ICall} from  "../interfaces/ICall.sol";

contract InvestmentHelper is ICall {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct DcaInvestment {
        uint208 poolId;
        uint16 swaps;
        uint8 percentage;
    }

    struct DcaInvestmentParams {
        DollarCostAverage dca;
        DcaInvestment[] dcaInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        address zapManager;
        bytes[] swaps;
    }

    error InvalidSwapsLength();

    function investInDca(
        DcaInvestmentParams memory _params
    ) external returns (uint[] memory) {
        if (_params.dcaInvestments.length == 0)
            return new uint[](0);

        if (_params.swaps.length != _params.dcaInvestments.length)
            revert InvalidSwapsLength();

        uint[] memory dcaPositionIds = new uint[](_params.dcaInvestments.length);
        uint nextDcaPositionId = _params.dca.getPositionsLength(address(this));

        for (uint i = 0; i < _params.dcaInvestments.length; i++) {
            DcaInvestment memory investment = _params.dcaInvestments[i];
            IERC20Upgradeable poolInputToken = IERC20Upgradeable(_params.dca.getPool(investment.poolId).inputToken);

            uint swapOutput = _zap(
                _params.zapManager,
                _params.swaps[i],
                _params.inputToken,
                poolInputToken,
                _params.amount * investment.percentage / 100
            );

            poolInputToken.safeIncreaseAllowance(address(_params.dca), swapOutput);

            _params.dca.depositUsingStrategy(investment.poolId, investment.swaps, swapOutput);

            dcaPositionIds[i] = nextDcaPositionId;
            nextDcaPositionId++;
        }

        return dcaPositionIds;
    }

    /**
     * @param _swapOrZap - Encoded version of ZapManager.ProtocolCall
     * @param _inputToken - Token to be sold
     * @param _outputToken - Token to be bought
     * @param _amount - Amount of input tokens to be sold
     * @return Amount of output tokens bought, if no zap is needed, returns input token amount
     */
    function _zap(
        address _zapManager,
        bytes memory _swapOrZap,
        IERC20Upgradeable _inputToken,
        IERC20Upgradeable _outputToken,
        uint _amount
    ) internal virtual returns (uint) {
        if (_swapOrZap.length > 1 && _inputToken != _outputToken) {
            _inputToken.safeTransfer(_zapManager, _amount);

            uint initialBalance = _outputToken.balanceOf(address(this));

            (bool success, bytes memory data) = _zapManager.call(_swapOrZap);

            if (!success)
                revert LowLevelCallFailed(_zapManager, _swapOrZap, data);

            return _outputToken.balanceOf(address(this)) - initialBalance;
        }

        return _amount;
    }
}
