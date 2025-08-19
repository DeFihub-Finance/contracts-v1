// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {StrategyStorage} from "./StrategyStorage.sol";
import {DollarCostAverage} from "../DollarCostAverage.sol";
import {IBeefyVaultV7} from '../interfaces/IBeefyVaultV7.sol';
import {INonfungiblePositionManager} from '../interfaces/INonfungiblePositionManager.sol';
import {LiquidityStorage} from "../libraries/LiquidityStorage.sol";
import {PairHelpers} from "../helpers/PairHelpers.sol";

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
                position.strategyId
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
        uint _strategyId
    ) private returns (uint[][] memory) {
        uint[][] memory withdrawnAmounts = new uint[][](_positions.length);

        for (uint index; index < _positions.length; ++index) {
            LiquidityPosition memory position = _positions[index];
            LiquidityMinOutputs memory minOutput = _minOutputs.length > index
                ? _minOutputs[index]
                : LiquidityMinOutputs(0, 0);
            PairHelpers.Pair memory pair = PairHelpers.fromLiquidityToken(
                position.positionManager,
                position.tokenId
            );

            // Claim must be called before decreasing liquidity to subtract fees only from rewards
            (uint fee0, uint fee1) = _claimLiquidityPositionTokens(position, pair);

            (uint userFee0, uint userFee1) = _distributeLiquidityRewards(_strategyId, pair, fee0, fee1);

            position.positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: position.tokenId,
                    liquidity: position.liquidity,
                    amount0Min: minOutput.minOutputToken0,
                    amount1Min: minOutput.minOutputToken1,
                    deadline: block.timestamp
                })
            );

            (uint amount0, uint amount1) = _claimLiquidityPositionTokens(position, pair);

            withdrawnAmounts[index] = new uint[](2);

            withdrawnAmounts[index][0] = amount0 + userFee0;
            withdrawnAmounts[index][1] = amount1 + userFee1;
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
                position.strategyId
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
        uint _strategyId
    ) private returns (uint[][] memory) {
        uint[][] memory withdrawnAmounts = new uint[][](_positions.length);

        for (uint index; index < _positions.length; ++index) {
            LiquidityPosition memory position = _positions[index];
            PairHelpers.Pair memory pair = PairHelpers.fromLiquidityToken(
                position.positionManager,
                position.tokenId
            );

            (uint fee0, uint fee1) = _claimLiquidityPositionTokens(position, pair);

            (uint userFee0, uint userFee1) = _distributeLiquidityRewards(_strategyId, pair, fee0, fee1);

            withdrawnAmounts[index] = new uint[](2);

            withdrawnAmounts[index][0] = userFee0;
            withdrawnAmounts[index][1] = userFee1;
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

    function _claimLiquidityPositionTokens(
        LiquidityPosition memory _position,
        PairHelpers.Pair memory _pair
    ) private returns (uint amount0, uint amount1) {
        (uint initialBalance0, uint initialBalance1) = PairHelpers.getBalances(_pair, address(this));

        _position.positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: _position.tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (uint finalBalance0, uint finalBalance1) = PairHelpers.getBalances(_pair, address(this));

        amount0 = finalBalance0 - initialBalance0;
        amount1 = finalBalance1 - initialBalance1;
    }

    function _distributeLiquidityRewards(
        uint _strategyId,
        PairHelpers.Pair memory _pair,
        uint _amount0,
        uint _amount1
    ) private returns (uint userAmount0, uint userAmount1) {
        LiquidityStorage.LiquidityStorageStruct storage liquidityStorage = LiquidityStorage.getLiquidityStruct();
        LiquidityFeeDistribution memory feeDistribution;
        address strategist = _strategies[_strategyId].creator;
        uint32 strategyLiquidityFeeBP = liquidityStorage.strategiesLiquidityFeeBP[_strategyId];

        if (strategyLiquidityFeeBP > 0) {
            feeDistribution.totalFee0 = _amount0 * strategyLiquidityFeeBP / 1e6;
            feeDistribution.totalFee1 = _amount1 * strategyLiquidityFeeBP / 1e6;
            feeDistribution.strategistFee0 = feeDistribution.totalFee0 * liquidityStorage.strategistRewardFeeSplitBP / 1e6;
            feeDistribution.strategistFee1 = feeDistribution.totalFee1 * liquidityStorage.strategistRewardFeeSplitBP / 1e6;
            feeDistribution.treasuryFee0 = feeDistribution.totalFee0 - feeDistribution.strategistFee0;
            feeDistribution.treasuryFee1 = feeDistribution.totalFee1 - feeDistribution.strategistFee1;

            liquidityStorage.rewardBalances[strategist][_pair.token0] += feeDistribution.strategistFee0;
            liquidityStorage.rewardBalances[strategist][_pair.token1] += feeDistribution.strategistFee1;

            emit Fee(
                msg.sender,
                strategist,
                feeDistribution.strategistFee0,
                abi.encode(_strategyId, _pair.token0, FEE_TO_STRATEGIST, FEE_OP_LIQUIDITY_FEES)
            );

            emit Fee(
                msg.sender,
                strategist,
                feeDistribution.strategistFee1,
                abi.encode(_strategyId, _pair.token1, FEE_TO_STRATEGIST, FEE_OP_LIQUIDITY_FEES)
            );

            liquidityStorage.rewardBalances[treasury][_pair.token0] += feeDistribution.treasuryFee0;
            liquidityStorage.rewardBalances[treasury][_pair.token1] += feeDistribution.treasuryFee1;

            emit Fee(
                msg.sender,
                treasury,
                feeDistribution.treasuryFee0,
                abi.encode(_strategyId, _pair.token0, FEE_TO_PROTOCOL, FEE_OP_LIQUIDITY_FEES)
            );

            emit Fee(
                msg.sender,
                treasury,
                feeDistribution.treasuryFee1,
                abi.encode(_strategyId, _pair.token1, FEE_TO_PROTOCOL, FEE_OP_LIQUIDITY_FEES)
            );
        }

        userAmount0 = _amount0 - feeDistribution.totalFee0;
        userAmount1 = _amount1 - feeDistribution.totalFee1;

        IERC20Upgradeable(_pair.token0).safeTransfer(msg.sender, userAmount0);
        IERC20Upgradeable(_pair.token1).safeTransfer(msg.sender, userAmount1);
    }
}
