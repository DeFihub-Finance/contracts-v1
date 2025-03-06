// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {StrategyInvestor} from "./abstract/StrategyInvestor.sol";
import {StrategyPositionManager} from "./abstract/StrategyPositionManager.sol";
import {StrategyManager} from './StrategyManager.sol';

contract StrategyManager__v2 is StrategyManager {
    function investNative(StrategyInvestor.InvestNativeParams calldata _params) external payable {
        _makeDelegateCall(
            strategyInvestor,
            abi.encodeWithSelector(
                StrategyInvestor.investNative.selector,
                _params
            )
        );
    }

    function closePositionIgnoringSlippage(uint _positionId) external virtual {
        _makeDelegateCall(
            strategyPositionManager,
            abi.encodeWithSelector(StrategyPositionManager.closePosition.selector, _positionId, '')
        );
    }
}
