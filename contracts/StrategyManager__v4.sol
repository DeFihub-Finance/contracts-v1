// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {StrategyManager__v3} from './StrategyManager__v3.sol';
import {LiquidityStorage} from "./libraries/LiquidityStorage.sol";
import {ReferralStorage} from "./libraries/ReferralStorage.sol";

contract StrategyManager__v4 is StrategyManager__v3 {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct InitializeParamsV3 {
        address strategyPositionManager;
        uint32 liquidityBaseStrategistPercentageBp;
    }

    uint32 constant public MAX_LIQUIDITY_FEE = 20 * 1e6 / 100; // 20% in basis points (1e6 = 100%)

    event CollectedRewards(address user, address token, uint amount);
    event LiquidityRewardFeeUpdated(uint strategyId, uint32 liquidityRewardFeeBP);

    error FeeTooHigh();

    function initialize_v3(
        InitializeParamsV3 memory _params
    ) external onlyOwner reinitializer(3) {
        strategyPositionManager = _params.strategyPositionManager;
        LiquidityStorage.getLiquidityStruct().baseStrategistPercentageBp = _params.liquidityBaseStrategistPercentageBp;
    }

    function createStrategyV2(
        CreateStrategyParams memory _params,
        uint32 _liquidityRewardFeeBP
    ) external virtual {
        _setLiquidityRewardFee(
            createStrategy(_params),
            _liquidityRewardFeeBP
        );
    }

    function collectRewards(address _token) public virtual {
        uint amount = getRewards(msg.sender, _token);

        if (amount == 0)
            return;

        LiquidityStorage.getLiquidityStruct().rewardBalances[msg.sender][_token] = 0;

        if (_token == address(stable)) {
            _strategistRewards[msg.sender] = 0;
            ReferralStorage.getReferralStruct().referrerRewards[msg.sender] = 0;
        }

        IERC20Upgradeable(_token).safeTransfer(msg.sender, amount);

        emit CollectedRewards(msg.sender, _token, amount);
    }

    function collectManyRewards(address[] memory _tokens) external virtual {
        for (uint i = 0; i < _tokens.length; ++i)
            collectRewards(_tokens[i]);
    }

    function getRewards(address _strategist, address _token) public virtual view returns (uint) {
        uint liquidityRewards = LiquidityStorage.getLiquidityStruct().rewardBalances[_strategist][_token];
        uint referrerRewards = ReferralStorage.getReferralStruct().referrerRewards[_strategist];

        return _token == address(stable)
            ? _strategistRewards[_strategist] + liquidityRewards + referrerRewards
            : liquidityRewards;
    }

    function getLiquidityRewardFee(uint _strategyId) external view returns (uint32) {
        return LiquidityStorage.getLiquidityStruct().feePerStrategyId[_strategyId];
    }

    function _setLiquidityRewardFee(uint _strategyId, uint32 _liquidityRewardFeeBP) internal virtual {
        if (_liquidityRewardFeeBP > MAX_LIQUIDITY_FEE)
            revert FeeTooHigh();

        LiquidityStorage.getLiquidityStruct().feePerStrategyId[_strategyId] = _liquidityRewardFeeBP;

        emit LiquidityRewardFeeUpdated(_strategyId, _liquidityRewardFeeBP);
    }
}
