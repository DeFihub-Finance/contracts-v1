// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {ZapLib} from "../libraries/ZapLib.sol";
import {SubscriptionManager} from "../SubscriptionManager.sol";
import {StrategyStorage} from "./StrategyStorage.sol";
import {UseFee} from "./UseFee.sol";

contract StrategyFundsCollector is StrategyStorage {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct PullFundsParams {
        uint strategyId;
        bool isHot;
        IERC20Upgradeable inputToken;
        uint inputAmount;
        bytes inputTokenSwap;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
    }

    struct PullFundsResult {
        uint remainingAmount;
        uint strategistFee;
    }

    function pullFunds(
        PullFundsParams memory _params
    ) external virtual returns (
        PullFundsResult memory
    ) {
        Strategy storage strategy = _strategies[_params.strategyId];

        bool strategistSubscribed = subscriptionManager.isSubscribed(strategy.creator, _params.strategistPermit);
        bool userSubscribed = subscriptionManager.isSubscribed(msg.sender, _params.investorPermit);
        uint initialInputTokenBalance = _params.inputToken.balanceOf(address(this));

        _params.inputToken.safeTransferFrom(msg.sender, address(this), _params.inputAmount);

        uint stableAmount = ZapLib.zap(
            zapManager,
            _params.inputTokenSwap,
            _params.inputToken,
            stable,
            _params.inputToken.balanceOf(address(this)) - initialInputTokenBalance
        );

        // Divided by multiplier 10_000 (fee percentage) * 100 (strategy percentage per investment) = 1M
        uint totalFee = stableAmount * (
            _getProductFee(strategy.percentages[PRODUCT_DCA], dca, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_VAULTS], vaultManager, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_LIQUIDITY], liquidityManager, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_BUY], buyProduct, userSubscribed)
        ) / 1_000_000;
        uint strategistFee;

        if (strategistSubscribed) {
            uint currentStrategistPercentage = _params.isHot // TODO move isHot logic to stratmanager
                ? hotStrategistPercentage
                : strategistPercentage;

            strategistFee = totalFee * currentStrategistPercentage / 100;
        }

        uint protocolFee = totalFee - strategistFee;

        stable.safeTransfer(treasury, protocolFee);

        if (strategistFee > 0) {
            _strategistRewards[strategy.creator] += strategistFee;

            emit UseFee.Fee(msg.sender, strategy.creator, strategistFee, abi.encode(_params.strategyId));
        }

        emit UseFee.Fee(msg.sender, treasury, protocolFee, abi.encode(_params.strategyId));

        return PullFundsResult(
            stableAmount - (protocolFee + strategistFee),
            strategistFee
        );
    }

    function _getProductFee(
        uint8 _productPercentage,
        UseFee _product,
        bool _userSubscribed
    ) internal view returns (uint32) {
        if (_productPercentage == 0)
            return 0;

        return _product.getFeePercentage(_userSubscribed) * _productPercentage;
    }
}
