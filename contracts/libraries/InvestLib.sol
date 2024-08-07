// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ICall} from  "../interfaces/ICall.sol";
import {IBeefyVaultV7} from '../interfaces/IBeefyVaultV7.sol';
import {INonfungiblePositionManager} from '../interfaces/INonfungiblePositionManager.sol';
import {DollarCostAverage} from '../DollarCostAverage.sol';
import {VaultManager} from '../VaultManager.sol';
import {LiquidityManager} from "../LiquidityManager.sol";
import {ZapManager} from "../zap/ZapManager.sol";
import {IERC20Mintable} from "../test/TestRouter.sol";
import {ZapLib} from "./ZapLib.sol";

library InvestLib {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    error InvalidParamsLength();
    error InsufficientFunds();

    /**
     * Investment structs
     *
     * Interfaces of how investments are stored for each product in a strategy
     */

    struct DcaInvestment {
        uint208 poolId;
        uint16 swaps;
        uint8 percentage;
    }

    struct VaultInvestment {
        address vault;
        uint8 percentage;
    }

    struct LiquidityInvestment {
        INonfungiblePositionManager positionManager;
        IERC20Upgradeable token0;
        IERC20Upgradeable token1;
        uint24 fee;
        uint16 lowerPricePercentage;
        uint16 upperPricePercentage;
        uint8 percentage;
    }

    struct TokenInvestment {
        IERC20Upgradeable token;
        uint8 percentage;
    }

    /**
     * Invest Params structs
     *
     * Interfaces of the internal functions of the InvestLib library that are used to invest in each product
     */

    struct DcaInvestmentParams {
        DollarCostAverage dca;
        DcaInvestment[] dcaInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        ZapManager zapManager;
        bytes[] swaps;
    }

    struct VaultInvestmentParams {
        VaultManager vaultManager;
        VaultInvestment[] vaultInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        ZapManager zapManager;
        bytes[] swaps;
    }

    /// part of LiquidityInvestParams
    struct LiquidityInvestZapParams {
        bytes swapToken0;
        bytes swapToken1;
        uint swapAmountToken0;
        uint swapAmountToken1;
        int24 tickLower;
        int24 tickUpper;
        uint amount0Min;
        uint amount1Min;
    }

    struct LiquidityInvestParams {
        address treasury;
        LiquidityManager liquidityManager;
        LiquidityInvestment[] investments;
        IERC20Upgradeable inputToken;
        uint amount;
        uint8 liquidityTotalPercentage;
        LiquidityInvestZapParams[] zaps;
    }

    struct TokenInvestParams {
        TokenInvestment[] investments;
        IERC20Upgradeable inputToken;
        uint amount;
        ZapManager zapManager;
        bytes[] swaps;
    }

    struct InvestParams {
        address treasury;
        DollarCostAverage dca;
        VaultManager vaultManager;
        LiquidityManager liquidityManager;
        ZapManager zapManager;
        IERC20Upgradeable inputToken;
        uint amount;
        // dca
        DcaInvestment[] dcaInvestments;
        bytes[] dcaSwaps;
        // vaults
        VaultInvestment[] vaultInvestments;
        bytes[] vaultSwaps;
        // liquidity
        LiquidityInvestment[] liquidityInvestments;
        LiquidityInvestZapParams[] liquidityZaps;
        uint8 liquidityTotalPercentage;
        // tokens
        TokenInvestment[] tokenInvestments;
        bytes[] tokenSwaps;
    }

    /**
     * Position structs
     *
     * Interfaces for users' positions to be stored in the Strategy contract
     */

    struct VaultPosition {
        address vault;
        uint amount;
    }

    struct LiquidityPosition {
        // TODO check if position manager is really necessary since it is already available in LiquidityInvestment struct
        INonfungiblePositionManager positionManager;
        uint tokenId;
        uint128 liquidity;
    }

    struct TokenPosition {
        IERC20Upgradeable token;
        uint amount;
    }

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
        TokenPosition[] tokenPositions;
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
        TokenPosition[] tokenPositions;
    }

    function invest(
        InvestParams memory _params
    ) external returns (
        uint[] memory dcaPositionIds,
        VaultPosition[] memory vaultPositions,
        LiquidityPosition[] memory liquidityPositions,
        TokenPosition[] memory tokenPositions
    ) {
        dcaPositionIds = _investInDca(
            DcaInvestmentParams({
                dca: _params.dca,
                dcaInvestments: _params.dcaInvestments,
                inputToken: _params.inputToken,
                amount: _params.amount,
                zapManager: _params.zapManager,
                swaps: _params.dcaSwaps
            })
        );

        vaultPositions = _investInVaults(
            VaultInvestmentParams({
                vaultManager: _params.vaultManager,
                vaultInvestments: _params.vaultInvestments,
                inputToken: _params.inputToken,
                amount: _params.amount,
                zapManager: _params.zapManager,
                swaps: _params.vaultSwaps
            })
        );

        liquidityPositions = _investInLiquidity(
            LiquidityInvestParams({
                treasury: _params.treasury,
                liquidityManager: _params.liquidityManager,
                investments: _params.liquidityInvestments,
                inputToken: _params.inputToken,
                amount: _params.amount,
                liquidityTotalPercentage: _params.liquidityTotalPercentage,
                zaps: _params.liquidityZaps
            })
        );

        tokenPositions = _investInToken(
            TokenInvestParams({
                investments: _params.tokenInvestments,
                inputToken: _params.inputToken,
                amount: _params.amount,
                zapManager: _params.zapManager,
                swaps: _params.tokenSwaps
            })
        );
    }

    function _investInDca(
        DcaInvestmentParams memory _params
    ) private returns (uint[] memory) {
        if (_params.dcaInvestments.length == 0)
            return new uint[](0);

        if (_params.dcaInvestments.length != _params.swaps.length)
            revert InvalidParamsLength();

        uint[] memory dcaPositionIds = new uint[](_params.dcaInvestments.length);
        uint nextDcaPositionId = _params.dca.getPositionsLength(address(this));

        for (uint i; i < _params.dcaInvestments.length; ++i) {
            DcaInvestment memory investment = _params.dcaInvestments[i];
            IERC20Upgradeable poolInputToken = IERC20Upgradeable(_params.dca.getPool(investment.poolId).inputToken);

            uint swapOutput = ZapLib.zap(
                _params.zapManager,
                _params.swaps[i],
                _params.inputToken,
                poolInputToken,
                _params.amount * investment.percentage / 100
            );

            poolInputToken.safeTransfer(address(_params.dca), swapOutput);

            _params.dca.investUsingStrategy(investment.poolId, investment.swaps, swapOutput);

            dcaPositionIds[i] = nextDcaPositionId;
            ++nextDcaPositionId;
        }

        return dcaPositionIds;
    }

    function _investInVaults(
        VaultInvestmentParams memory _params
    ) private returns (VaultPosition[] memory) {
        if (_params.vaultInvestments.length == 0)
            return new VaultPosition[](0);

        if (_params.vaultInvestments.length != _params.swaps.length)
            revert InvalidParamsLength();

        VaultPosition[] memory vaultPositions = new VaultPosition[](_params.vaultInvestments.length);

        for (uint i; i < _params.vaultInvestments.length; ++i) {
            VaultInvestment memory investment = _params.vaultInvestments[i];
            IBeefyVaultV7 vault = IBeefyVaultV7(investment.vault);
            IERC20Upgradeable vaultWantToken = vault.want();

            uint swapOutput = ZapLib.zap(
                _params.zapManager,
                _params.swaps[i],
                _params.inputToken,
                vaultWantToken,
                _params.amount * investment.percentage / 100
            );

            vaultWantToken.safeTransfer(address(_params.vaultManager), swapOutput);

            uint initialBalance = vault.balanceOf(address(this));
            _params.vaultManager.investUsingStrategy(investment.vault, swapOutput);
            vaultPositions[i] = VaultPosition(
                investment.vault,
                vault.balanceOf(address(this)) - initialBalance
            );
        }

        return vaultPositions;
    }

    function _investInLiquidity(
        LiquidityInvestParams memory _params
    ) private returns (LiquidityPosition[] memory) {
        if (_params.investments.length == 0)
            return new LiquidityPosition[](0);

        if (_params.investments.length != _params.zaps.length)
            revert InvalidParamsLength();

        LiquidityPosition[] memory liquidityPositions = new LiquidityPosition[](_params.investments.length);

        _params.inputToken.safeTransfer(
            address(_params.liquidityManager),
            _params.liquidityTotalPercentage * _params.amount / 100
        );

        for (uint i; i < _params.investments.length; ++i) {
            LiquidityInvestment memory investment = _params.investments[i];
            LiquidityInvestZapParams memory zap = _params.zaps[i];
            uint currentInvestmentAmount = _params.amount * investment.percentage / 100;

            if (zap.swapAmountToken0 + zap.swapAmountToken1 > currentInvestmentAmount)
                revert InsufficientFunds();

            (uint tokenId, uint128 liquidity) = _params.liquidityManager.investUniswapV3UsingStrategy(
                LiquidityManager.InvestUniswapV3Params({
                    positionManager: address(investment.positionManager),
                    inputToken: _params.inputToken,
                    depositAmountInputToken: currentInvestmentAmount,
                    token0: investment.token0,
                    token1: investment.token1,
                    fee: investment.fee,
                    swapToken0: zap.swapToken0,
                    swapToken1: zap.swapToken1,
                    swapAmountToken0: zap.swapAmountToken0,
                    swapAmountToken1: zap.swapAmountToken1,
                    tickLower: zap.tickLower,
                    tickUpper: zap.tickUpper,
                    amount0Min: zap.amount0Min,
                    amount1Min: zap.amount1Min
                })
            );

            liquidityPositions[i] = LiquidityPosition(
                investment.positionManager,
                tokenId,
                liquidity
            );
        }

        return liquidityPositions;
    }

    function _investInToken(
        TokenInvestParams memory _params
    ) private returns (TokenPosition[] memory) {
        if (_params.swaps.length == 0)
            return new TokenPosition[](0);

        TokenPosition[] memory tokenPositions = new TokenPosition[](_params.swaps.length);

        for (uint i; i < _params.swaps.length; ++i) {
            TokenInvestment memory investment = _params.investments[i];

            uint swapOutput = ZapLib.zap(
                _params.zapManager,
                _params.swaps[i],
                _params.inputToken,
                investment.token,
                _params.amount * investment.percentage / 100
            );

            tokenPositions[i] = TokenPosition(
                investment.token,
                swapOutput
            );
        }

        return tokenPositions;
    }

    function closePosition(ClosePositionParams memory _params) external returns (
        uint[][] memory dcaWithdrawnAmounts,
        uint[] memory vaultWithdrawnAmounts,
        uint[][] memory liquidityWithdrawnAmounts,
        uint[] memory tokenWithdrawnAmounts
    ) {
        return (
            _closeDcaPositions(_params.dca, _params.dcaPositions),
            _closeVaultPositions(_params.vaultPositions),
            _closeLiquidityPositions(_params.liquidityPositions, _params.liquidityMinOutputs),
            _closeTokenPositions(_params.tokenPositions)
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

            _dca.withdrawAll(positionId);

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

    function _closeTokenPositions(
        TokenPosition[] memory _positions
    ) private returns (uint[] memory) {
        uint[] memory withdrawnAmounts = new uint[](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            TokenPosition memory position = _positions[i];

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
        uint[] memory tokenWithdrawnAmounts
    ) {
        return (
            _collectPositionsDca(_params.dca, _params.dcaPositions),
            _collectPositionsLiquidity(_params.liquidityPositions),
            _collectPositionsToken(_params.tokenPositions)
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

            _dca.withdrawSwapped(positionId);

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
        TokenPosition[] memory _positions
    ) private returns (uint[] memory) {
        uint[] memory withdrawnAmounts = new uint[](_positions.length);

        for (uint i; i < _positions.length; ++i) {
            TokenPosition memory position = _positions[i];
            uint initialBalance = position.token.balanceOf(address(this));

            position.token.safeTransfer(msg.sender, position.amount);

            withdrawnAmounts[i] = position.token.balanceOf(address(this)) - initialBalance;
        }

        return withdrawnAmounts;
    }
}
