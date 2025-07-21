// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {StrategyStorage} from "./StrategyStorage.sol";
import {DollarCostAverage} from "../DollarCostAverage.sol";
import {IBeefyVaultV7} from '../interfaces/IBeefyVaultV7.sol';
import {INonfungiblePositionManager} from '../interfaces/INonfungiblePositionManager.sol';
import {LiquidityStorage} from "../libraries/LiquidityStorage.sol";
import {PairHelpers} from "../helpers/PairHelpers.sol";
import "hardhat/console.sol";

contract StrategyPositionManager is StrategyStorage {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct LiquidityMinOutputs {
        uint minOutputToken0;
        uint minOutputToken1;
    }

    struct LiquidityFeeDistribution {
        uint totalFee0;
        uint totalFee1;
        uint strategistFee0;
        uint strategistFee1;
        uint treasuryFee0;
        uint treasuryFee1;
    }

    event StrategyLiquidityFee(
        address from,
        address to,
        uint amount0,
        uint amount1,
        uint strategyId,
        uint positionId,
        uint liquidityPositionIndex
    );

    error PositionAlreadyClosed();
    error InvalidPositionId(address investor, uint positionId);

    function closePosition(
        uint _positionId,
        LiquidityMinOutputs[] calldata _liquidityMinOutputs
    ) external {
        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        position.closed = true;

        emit PositionClosed(
            msg.sender,
            position.strategyId,
            _positionId,
            _closePositionsDca(_dcaPositionsPerPosition[msg.sender][_positionId]),
            _closePositionsVault(_vaultPositionsPerPosition[msg.sender][_positionId]),
            _closePositionsLiquidity(
                _liquidityPositionsPerPosition[msg.sender][_positionId],
                _liquidityMinOutputs,
                position.strategyId,
                _positionId
            ),
            _collectPositionsBuy(_buyPositionsPerPosition[msg.sender][_positionId])
        );
    }

    function _closePositionsDca(
        uint[] memory _positions
    ) private returns (uint[][] memory) {
        uint[][] memory withdrawnAmounts = new uint[][](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            uint positionId = _positions[i];
            DollarCostAverage.PoolInfo memory poolInfo = dca.getPool(
                dca.getPosition(address(this), positionId).poolId
            );
            IERC20Upgradeable inputToken = IERC20Upgradeable(poolInfo.inputToken);
            IERC20Upgradeable outputToken = IERC20Upgradeable(poolInfo.outputToken);
            uint initialInputTokenBalance = inputToken.balanceOf(address(this));
            uint initialOutputTokenBalance = outputToken.balanceOf(address(this));

            dca.closePosition(positionId);

            uint inputTokenAmount = inputToken.balanceOf(address(this)) - initialInputTokenBalance;
            uint outputTokenAmount = outputToken.balanceOf(address(this)) - initialOutputTokenBalance;

            if (inputTokenAmount > 0 || outputTokenAmount > 0) {
                withdrawnAmounts[i] = new uint[](2);

                if (inputTokenAmount > 0) {
                    withdrawnAmounts[i][0] = inputTokenAmount;
                    inputToken.safeTransfer(msg.sender, inputTokenAmount);
                }

                if (outputTokenAmount > 0) {
                    withdrawnAmounts[i][1] = outputTokenAmount;
                    outputToken.safeTransfer(msg.sender, outputTokenAmount);
                }
            }
        }

        return withdrawnAmounts;
    }

    function _closePositionsVault(
        VaultPosition[] memory _positions
    ) private returns (uint[] memory) {
        uint[] memory withdrawnAmounts = new uint[](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            VaultPosition memory vaultPosition = _positions[i];
            IBeefyVaultV7 vault = IBeefyVaultV7(vaultPosition.vault);

            uint initialBalance = vault.want().balanceOf(address(this));

            vault.withdraw(vaultPosition.amount);

            uint withdrawnAmount = vault.want().balanceOf(address(this)) - initialBalance;

            if (withdrawnAmount > 0) {
                withdrawnAmounts[i] = withdrawnAmount;
                vault.want().safeTransfer(msg.sender, withdrawnAmount);
            }
        }

        return withdrawnAmounts;
    }

    function _closePositionsLiquidity(
        LiquidityPosition[] memory _positions,
        LiquidityMinOutputs[] memory _minOutputs,
        uint _strategyId,
        uint _positionId
    ) private returns (uint[][] memory) {
        uint[][] memory withdrawnAmounts = new uint[][](_positions.length);
        address strategist = _strategies[_strategyId].creator;

        for (uint index; index < _positions.length; ++index) {
            LiquidityPosition memory position = _positions[index];
            LiquidityMinOutputs memory minOutput = _minOutputs.length > index
                ? _minOutputs[index]
                : LiquidityMinOutputs(0, 0);
            PairHelpers.Pair memory pair = PairHelpers.fromLiquidityToken(
                position.positionManager,
                position.tokenId
            );

            position.positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: position.tokenId,
                    liquidity: position.liquidity,
                    amount0Min: minOutput.minOutputToken0,
                    amount1Min: minOutput.minOutputToken1,
                    deadline: block.timestamp
                })
            );

            (uint amount0, uint amount1) = _claimUniswapLiquidityTokens(position, pair);

            withdrawnAmounts[index] = _distributeLiquidityRewards(
                _strategyId,
                _positionId,
                index,
                pair,
                amount0,
                amount1,
                strategist
            );
        }

        return withdrawnAmounts;
    }

    function collectPosition(uint _positionId) external {
        if (_positionId >= _positions[msg.sender].length)
            revert InvalidPositionId(msg.sender, _positionId);

        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        BuyPosition[] memory buyPositions = _buyPositionsPerPosition[msg.sender][_positionId];

        if (buyPositions.length > 0)
            delete _buyPositionsPerPosition[msg.sender][_positionId];

        emit PositionCollected(
            msg.sender,
            position.strategyId,
            _positionId,
            _collectPositionsDca(_dcaPositionsPerPosition[msg.sender][_positionId]),
            _collectPositionsLiquidity(
                _liquidityPositionsPerPosition[msg.sender][_positionId],
                position.strategyId,
                _positionId
            ),
            _collectPositionsBuy(buyPositions)
        );
    }

    function _collectPositionsDca(uint[] memory _positions) private returns (uint[] memory) {
        uint[] memory withdrawnAmounts = new uint[](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            uint positionId = _positions[i];
            DollarCostAverage.PoolInfo memory poolInfo = dca.getPool(dca.getPosition(address(this), positionId).poolId);
            IERC20Upgradeable outputToken = IERC20Upgradeable(poolInfo.outputToken);
            uint initialOutputTokenBalance = outputToken.balanceOf(address(this));

            dca.collectPosition(positionId);

            uint outputTokenAmount = outputToken.balanceOf(address(this)) - initialOutputTokenBalance;

            if (outputTokenAmount > 0) {
                withdrawnAmounts[i] = outputTokenAmount;
                outputToken.safeTransfer(msg.sender, outputTokenAmount);
            }
        }

        return withdrawnAmounts;
    }

    function _collectPositionsLiquidity(
        LiquidityPosition[] memory _positions,
        uint _strategyId,
        uint _positionId
    ) private returns (uint[][] memory) {
        uint[][] memory withdrawnAmounts = new uint[][](_positions.length);
        address strategist = _strategies[_strategyId].creator;

        for (uint index; index < _positions.length; ++index) {
            LiquidityPosition memory position = _positions[index];
            PairHelpers.Pair memory pair = PairHelpers.fromLiquidityToken(
                position.positionManager,
                position.tokenId
            );

            (uint amount0, uint amount1) = _claimUniswapLiquidityTokens(position, pair);

            withdrawnAmounts[index] = _distributeLiquidityRewards(
                _strategyId,
                _positionId,
                index,
                pair,
                amount0,
                amount1,
                strategist
            );
        }

        return withdrawnAmounts;
    }

    function _collectPositionsBuy(
        BuyPosition[] memory _positions
    ) private returns (uint[] memory) {
        uint[] memory withdrawnAmounts = new uint[](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            BuyPosition memory position = _positions[i];
            position.token.safeTransfer(msg.sender, position.amount);
            withdrawnAmounts[i] = position.amount;
        }

        return withdrawnAmounts;
    }

    function _claimUniswapLiquidityTokens(
        LiquidityPosition memory _position,
        PairHelpers.Pair memory pair
    ) private returns (uint amount0, uint amount1) {
        (uint initialBalance0, uint initialBalance1) = PairHelpers.getBalances(pair, address(this));

        _position.positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: _position.tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (uint finalBalance0, uint finalBalance1) = PairHelpers.getBalances(pair, address(this));

        amount0 = finalBalance0 - initialBalance0;
        amount1 = finalBalance1 - initialBalance1;
    }

    function _distributeLiquidityRewards(
        uint _strategyId,
        uint _strategyPositionId,
        uint _liquidityPositionIndex,
        PairHelpers.Pair memory _pair,
        uint _amount0,
        uint _amount1,
        address _strategist
    ) private returns (uint[] memory withdrawnAmounts) {
        LiquidityStorage.LiquidityStorageStruct storage liquidityStorage = LiquidityStorage.getLiquidityStruct();
        LiquidityFeeDistribution memory feeDistribution;

        feeDistribution.totalFee0 = _amount0 * liquidityStorage.baseRewardFeeBp / 1e6;
        feeDistribution.totalFee1 = _amount1 * liquidityStorage.baseRewardFeeBp / 1e6;
        feeDistribution.strategistFee0 = feeDistribution.totalFee0 * liquidityStorage.baseStrategistPercentageBp / 1e6;
        feeDistribution.strategistFee1 = feeDistribution.totalFee1 * liquidityStorage.baseStrategistPercentageBp / 1e6;
        feeDistribution.treasuryFee0 = feeDistribution.totalFee0 - feeDistribution.strategistFee0;
        feeDistribution.treasuryFee1 = feeDistribution.totalFee1 - feeDistribution.strategistFee1;

        liquidityStorage.rewardBalances[_strategist][_pair.token0] += feeDistribution.strategistFee0;
        liquidityStorage.rewardBalances[_strategist][_pair.token1] += feeDistribution.strategistFee1;

        emit StrategyLiquidityFee(
            msg.sender,
            _strategist,
            feeDistribution.strategistFee0,
            feeDistribution.strategistFee1,
            _strategyId,
            _strategyPositionId,
            _liquidityPositionIndex
        );

        liquidityStorage.rewardBalances[treasury][_pair.token0] += feeDistribution.treasuryFee0;
        liquidityStorage.rewardBalances[treasury][_pair.token1] += feeDistribution.treasuryFee1;

        emit StrategyLiquidityFee(
            msg.sender,
            treasury,
            feeDistribution.treasuryFee0,
            feeDistribution.treasuryFee1,
            _strategyId,
            _strategyPositionId,
            _liquidityPositionIndex
        );

        IERC20Upgradeable(_pair.token0).safeTransfer(msg.sender, _amount0 - feeDistribution.totalFee0);
        IERC20Upgradeable(_pair.token1).safeTransfer(msg.sender, _amount1 - feeDistribution.totalFee1);

        withdrawnAmounts = new uint[](2);

        console.log(
            "a0",
            _amount0,
            feeDistribution.totalFee0,
            _amount0 - feeDistribution.totalFee0
        );
        console.log(
            "a1",
            _amount1,
            feeDistribution.totalFee1,
            _amount1 - feeDistribution.totalFee1
        );

        withdrawnAmounts[0] = _amount0 - feeDistribution.totalFee0;
        withdrawnAmounts[1] = _amount1 - feeDistribution.totalFee1;
    }
}
