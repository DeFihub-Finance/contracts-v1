// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {StrategyStorage} from "./StrategyStorage.sol";
import {DollarCostAverage} from "../DollarCostAverage.sol";
import {IBeefyVaultV7} from '../interfaces/IBeefyVaultV7.sol';
import {INonfungiblePositionManager} from '../interfaces/INonfungiblePositionManager.sol';

contract StrategyPositionManager is StrategyStorage {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * Close Position structs
     *
     * Interfaces for the functions that close users' positions in the Strategy contract
     */

    /// part of ClosePositionParams
    struct LiquidityMinOutputs {
        uint minOutputToken0;
        uint minOutputToken1;
    }

    struct ClosePositionParams {
        // dca
        DollarCostAverage dca;
        uint[] dcaPositions;
        // vaults
        VaultPosition[] vaultPositions;
        // liquidity
        LiquidityPosition[] liquidityPositions;
        LiquidityMinOutputs[] liquidityMinOutputs;
        // tokens
        BuyPosition[] buyPositions;
    }

    /**
     * Collect Position structs
     *
     * Interfaces for functions that collect users' funds/rewards without withdrawing the deposited amount
     */

    struct CollectPositionParams {
        // dca
        DollarCostAverage dca;
        uint[] dcaPositions;
        // liquidity
        LiquidityPosition[] liquidityPositions;
        // tokens
        BuyPosition[] buyPositions;
    }

    function closePosition(ClosePositionParams memory _params) external returns (
        uint[][] memory dcaWithdrawnAmounts,
        uint[] memory vaultWithdrawnAmounts,
        uint[][] memory liquidityWithdrawnAmounts,
        uint[] memory buyWithdrawnAmounts
    ) {
        return (
            _closeDcaPositions(_params.dca, _params.dcaPositions),
            _closeVaultPositions(_params.vaultPositions),
            _closeLiquidityPositions(_params.liquidityPositions, _params.liquidityMinOutputs),
            _closeBuyPositions(_params.buyPositions)
        );
    }

    function _closeDcaPositions(
        DollarCostAverage _dca,
        uint[] memory _positions
    ) private returns (uint[][] memory) {
        uint[][] memory withdrawnAmounts = new uint[][](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            uint positionId = _positions[i];
            DollarCostAverage.PoolInfo memory poolInfo = _dca.getPool(
                _dca.getPosition(address(this), positionId).poolId
            );
            IERC20Upgradeable inputToken = IERC20Upgradeable(poolInfo.inputToken);
            IERC20Upgradeable outputToken = IERC20Upgradeable(poolInfo.outputToken);
            uint initialInputTokenBalance = inputToken.balanceOf(address(this));
            uint initialOutputTokenBalance = outputToken.balanceOf(address(this));

            _dca.closePosition(positionId);

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

    function collectPosition(
        CollectPositionParams memory _params
    ) external returns (
        uint[] memory dcaWithdrawnAmounts,
        uint[][] memory liquidityWithdrawnAmounts,
        uint[] memory buyWithdrawnAmounts
    ) {
        return (
            _collectPositionsDca(_params.dca, _params.dcaPositions),
            _collectPositionsLiquidity(_params.liquidityPositions),
            _collectPositionsToken(_params.buyPositions)
        );
    }

    function _collectPositionsDca(
        DollarCostAverage _dca,
        uint[] memory _positions
    ) private returns (uint[] memory) {
        uint[] memory withdrawnAmounts = new uint[](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            uint positionId = _positions[i];
            DollarCostAverage.PoolInfo memory poolInfo = _dca.getPool(_dca.getPosition(address(this), positionId).poolId);
            IERC20Upgradeable outputToken = IERC20Upgradeable(poolInfo.outputToken);
            uint initialOutputTokenBalance = outputToken.balanceOf(address(this));

            _dca.collectPosition(positionId);

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

    function _collectPositionsToken(
        BuyPosition[] memory _positions
    ) private returns (uint[] memory) {
        uint[] memory withdrawnAmounts = new uint[](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            BuyPosition memory position = _positions[i];
            uint initialBalance = position.token.balanceOf(address(this));

            position.token.safeTransfer(msg.sender, position.amount);

            withdrawnAmounts[i] = position.token.balanceOf(address(this)) - initialBalance;
        }

        return withdrawnAmounts;
    }
}
