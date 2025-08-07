// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {StrategyManager__v2} from './StrategyManager__v2.sol';
import {LiquidityStorage} from "./libraries/LiquidityStorage.sol";
import {ReferralStorage} from "./libraries/ReferralStorage.sol";

contract StrategyManager__v3 is StrategyManager__v2 {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct InitializeParamsV3 {
        address strategyPositionManager;
        uint32 liquidityBaseRewardFeeBp;
        uint32 liquidityBaseStrategistPercentageBp;
    }

    event CollectedStrategistRewards(address user, address token, uint amount);

    function initialize_v3(
        InitializeParamsV3 memory _params
    ) external onlyOwner reinitializer(3) {
        strategyPositionManager = _params.strategyPositionManager;
        LiquidityStorage.getLiquidityStruct().baseRewardFeeBp = _params.liquidityBaseRewardFeeBp;
        LiquidityStorage.getLiquidityStruct().baseStrategistPercentageBp = _params.liquidityBaseStrategistPercentageBp;
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

        emit CollectedStrategistRewards(msg.sender, _token, amount);
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
}
