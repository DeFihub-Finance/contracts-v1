// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {StrategyStorage} from "./StrategyStorage.sol";
import {DollarCostAverage} from "../DollarCostAverage.sol";
import {IBeefyVaultV7} from '../interfaces/IBeefyVaultV7.sol';
import {INonfungiblePositionManager} from '../interfaces/INonfungiblePositionManager.sol';

contract StrategyPositionManager is StrategyStorage {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct LiquidityMinOutputs {
        uint minOutputToken0;
        uint minOutputToken1;
    }

    event PositionClosed(
        address user,
        uint strategyId,
        uint positionId,
        uint[][] dcaWithdrawnAmounts,
        uint[] vaultWithdrawnAmount,
        uint[][] liquidityWithdrawnAmounts,
        uint[] buyWithdrawnAmounts
    );

    event PositionCollected(
        address user,
        uint strategyId,
        uint positionId,
        uint[] dcaWithdrawnAmounts,
        uint[][] liquidityWithdrawnAmounts,
        uint[] buyWithdrawnAmounts
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
            _closeDcaPositions(_dcaPositionsPerPosition[msg.sender][_positionId]),
            _closeVaultPositions(_vaultPositionsPerPosition[msg.sender][_positionId]),
            _closeLiquidityPositions(_liquidityPositionsPerPosition[msg.sender][_positionId], _liquidityMinOutputs),
            _closeBuyPositions(_buyPositionsPerPosition[msg.sender][_positionId])
        );
    }

    function _closeDcaPositions(
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

    function _closeVaultPositions(
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

    function _closeLiquidityPositions(
        LiquidityPosition[] memory _positions,
        LiquidityMinOutputs[] memory _minOutputs
    ) private returns (uint[][] memory) {
        uint[][] memory withdrawnAmounts = new uint[][](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            LiquidityPosition memory position = _positions[i];
            LiquidityMinOutputs memory minOutput = _minOutputs[i];

            position.positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: position.tokenId,
                    liquidity: position.liquidity,
                    amount0Min: minOutput.minOutputToken0,
                    amount1Min: minOutput.minOutputToken1,
                    deadline: block.timestamp
                })
            );

            (uint amount0, uint amount1) = position.positionManager.collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId: position.tokenId,
                    recipient: msg.sender,
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );

            withdrawnAmounts[i] = new uint[](2);

            withdrawnAmounts[i][0] = amount0;
            withdrawnAmounts[i][1] = amount1;
        }

        return withdrawnAmounts;
    }

    function _closeBuyPositions(
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

    function collectPosition(uint _positionId) external  {
        if (_positionId >= _positions[msg.sender].length)
            revert InvalidPositionId(msg.sender, _positionId);

        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        BuyPosition[] memory buyPositions = _buyPositionsPerPosition[msg.sender][_positionId];

        // TODO test delete functionality and also test if can use storage with delete to save gas
        if (buyPositions.length > 0)
            delete _buyPositionsPerPosition[msg.sender][_positionId];

        emit PositionCollected(
            msg.sender,
            position.strategyId,
            _positionId,
            _collectPositionsDca(_dcaPositionsPerPosition[msg.sender][_positionId]),
            _collectPositionsLiquidity(_liquidityPositionsPerPosition[msg.sender][_positionId]),
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
        LiquidityPosition[] memory _positions
    ) private returns (uint[][] memory) {
        uint[][] memory withdrawnAmounts = new uint[][](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            LiquidityPosition memory position = _positions[i];

            (uint amount0, uint amount1) = position.positionManager.collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId: position.tokenId,
                    recipient: msg.sender,
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );

            withdrawnAmounts[i] = new uint[](2);

            withdrawnAmounts[i][0] = amount0;
            withdrawnAmounts[i][1] = amount1;
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
}
