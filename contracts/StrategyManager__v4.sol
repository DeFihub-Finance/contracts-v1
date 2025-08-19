// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {StrategyManager__v3} from './StrategyManager__v3.sol';
import {LiquidityStorage} from "./libraries/LiquidityStorage.sol";
import {ReferralStorage} from "./libraries/ReferralStorage.sol";

contract StrategyManager__v4 is StrategyManager__v3 {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint32 constant public MIN_STRATEGIST_SPLIT_BP = 50 * 1e6 / 100; // 50% in basis points (1e6 = 100%)
    uint32 constant public MAX_LIQUIDITY_FEE_BP = 25 * 1e6 / 100; // 25% in basis points (1e6 = 100%)

    event StrategistFeeSplitUpdated(uint32 strategistRewardFeeSplitBP);
    event LiquidityRewardFeeSet(uint strategyId, uint32 liquidityRewardFeeBP);

    error InvalidAmount();
    error FeeTooHigh();

    function initialize__v4(
        address _strategyPositionManager,
        uint32 _strategistRewardFeeSplitBP
    ) external onlyOwner reinitializer(4) {
        strategyPositionManager = _strategyPositionManager;
        _updateStrategistRewardFeeSplitBP(_strategistRewardFeeSplitBP);
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

    function collectRewards(address _token) public virtual override {
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

    function getRewards(address _strategist, address _token) public virtual override view returns (uint) {
        uint liquidityRewards = LiquidityStorage.getLiquidityStruct().rewardBalances[_strategist][_token];

        if (_token == address(stable)) {
            uint strategistRewards = _strategistRewards[_strategist];
            uint referrerRewards = ReferralStorage.getReferralStruct().referrerRewards[_strategist];

            return liquidityRewards + strategistRewards + referrerRewards;
        }

        return liquidityRewards;
    }

    function getLiquidityRewardFee(uint _strategyId) external view returns (uint32) {
        return LiquidityStorage.getLiquidityStruct().feePerStrategyId[_strategyId];
    }

    function updateStrategistRewardFeeSplitBP(uint32 _strategistRewardFeeSplitBP) external onlyOwner {
        _updateStrategistRewardFeeSplitBP(_strategistRewardFeeSplitBP);
    }

    function _updateStrategistRewardFeeSplitBP(uint32 _strategistRewardFeeSplitBP) internal {
        if (_strategistRewardFeeSplitBP < MIN_STRATEGIST_SPLIT_BP)
            revert InvalidAmount();

        LiquidityStorage.getLiquidityStruct().strategistRewardFeeSplitBP = _strategistRewardFeeSplitBP;

        emit StrategistFeeSplitUpdated(_strategistRewardFeeSplitBP);
    }

    function _setLiquidityRewardFee(uint _strategyId, uint32 _liquidityRewardFeeBP) internal virtual {
        if (_liquidityRewardFeeBP > MAX_LIQUIDITY_FEE_BP)
            revert FeeTooHigh();

        LiquidityStorage.getLiquidityStruct().feePerStrategyId[_strategyId] = _liquidityRewardFeeBP;

        emit LiquidityRewardFeeSet(_strategyId, _liquidityRewardFeeBP);
    }
}
