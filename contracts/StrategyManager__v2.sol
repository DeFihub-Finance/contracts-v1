// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {StrategyInvestor} from "./abstract/StrategyInvestor.sol";
import {StrategyPositionManager} from "./abstract/StrategyPositionManager.sol";
import {StrategyManager} from './StrategyManager.sol';
import {ReferralStorage} from "./libraries/ReferralStorage.sol";

contract StrategyManager__v2 is StrategyManager {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event Referral(address referrer, address referred);
    event ReferrerPercentageUpdated(uint32 percentage);
    event CollectedReferrerRewards(address referrer, uint amount);

    function initialize__v2(
        address _strategyInvestor,
        address _strategyPositionManager,
        uint32 _referrerPercentage
    ) external onlyOwner reinitializer(2) {
        strategyInvestor = _strategyInvestor;
        strategyPositionManager = _strategyPositionManager;
        ReferralStorage.getReferralStruct().referrerPercentage = _referrerPercentage;
    }

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

    function closePositionIgnoringSlippage(uint _positionId) public virtual {
        _makeDelegateCall(
            strategyPositionManager,
            abi.encodeWithSelector(StrategyPositionManager.closePosition.selector, _positionId, '')
        );
    }

    // @notice if too many positions are open, this can run out of gas
    function closeAllPositionsIgnoringSlippage() external virtual {
        Position[] memory positions = _positions[msg.sender];

        for (uint positionId = 0; positionId < positions.length; ++positionId) {
            if (!positions[positionId].closed)
                closePositionIgnoringSlippage(positionId);
        }
    }

    function setReferrerPercentage(uint32 _referrerPercentage) public virtual onlyOwner {
        if (_referrerPercentage > 100)
            revert PercentageTooHigh();

        ReferralStorage.getReferralStruct().referrerPercentage = _referrerPercentage;

        emit ReferrerPercentageUpdated(_referrerPercentage);
    }

    function referrerPercentage() external virtual view returns (uint32) {
        return ReferralStorage.getReferralStruct().referrerPercentage;
    }

    function getReferrerRewards(address _referrer) external virtual view returns (uint) {
        return ReferralStorage.getReferralStruct().referrerRewards[_referrer];
    }

    function collectReferrerRewards() public virtual {
        ReferralStorage.ReferralStruct storage referralStorage = ReferralStorage.getReferralStruct();

        uint referrerReward = referralStorage.referrerRewards[msg.sender];

        referralStorage.referrerRewards[msg.sender] = 0;
        stable.safeTransfer(msg.sender, referrerReward);

        emit CollectedReferrerRewards(msg.sender, referrerReward);
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
}
