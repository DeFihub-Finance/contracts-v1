// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {StrategyInvestor} from "./abstract/StrategyInvestor.sol";
import {StrategyPositionManager} from "./abstract/StrategyPositionManager.sol";
import {SubscriptionManager} from "./SubscriptionManager.sol";
import {StrategyManager} from './StrategyManager.sol';
import {ReferralStorage} from "./libraries/ReferralStorage.sol";

// TODO test upgrade compatibility
contract StrategyManager__v2 is StrategyManager {
    event Referral(address referrer, address referred);

    // TODO add reinitializer for referrerPercentage

    function investV2(StrategyInvestor.InvestParams calldata _params, address _referrer) external virtual {
        _setReferrer(_referrer);

        _makeDelegateCall(
            strategyInvestor,
            abi.encodeWithSelector(
                StrategyInvestor.invest.selector,
                _params
            )
        );
    }

    function investNativeV2(StrategyInvestor.InvestNativeParams calldata _params, address _referrer) external payable {
        _setReferrer(_referrer);

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

    function _setReferrer(address _referrer) private {
        ReferralStorage.ReferralStruct storage referralStorage = ReferralStorage.getReferralStruct();

        if (
            _referrer == address(0) || // ignores zero address
            _referrer == msg.sender || // referrer cannot be msg.sender
            referralStorage.referrals[msg.sender] != address(0) // referrer cannot be replaced
        )
            return;

        referralStorage.referrals[msg.sender] = _referrer;

        emit Referral(_referrer, msg.sender);
    }

    function getReferrerRewards(address _referrer) external virtual view returns (uint) {
        return ReferralStorage.getReferralStruct().referrerRewards[_referrer];
    }
}
