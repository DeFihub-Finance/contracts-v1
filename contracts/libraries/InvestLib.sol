// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ICall} from  "../interfaces/ICall.sol";
import {IBeefyVaultV7} from '../interfaces/IBeefyVaultV7.sol';
import {DollarCostAverage} from '../DollarCostAverage.sol';
import {VaultManager} from '../VaultManager.sol';
import {LiquidityManager} from "../LiquidityManager.sol";
import {ZapManager} from "../zap/ZapManager.sol";

library InvestLib {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    error InvalidParamsLength();

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
        address positionManager;
        IERC20Upgradeable token0;
        IERC20Upgradeable token1;
        uint24 fee;
        uint16 pricePercentageThresholdBelow;
        uint16 pricePercentageThresholdAbove;
        uint8 percentage;
    }

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

    struct LiquidityZapParams {
        bytes swapToken0;
        bytes swapToken1;
        uint swapAmountToken0;
        uint swapAmountToken1;
        int24 tickLower;
        int24 tickUpper;
        uint amount0Min;
        uint amount1Min;
        bytes zapToken0;
        bytes zapToken1;
    }

    struct LiquidityInvestParams {
        address treasury;
        LiquidityManager liquidityManager;
        LiquidityInvestment[] liquidityInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        LiquidityZapParams[] zaps;
    }

    struct VaultPosition {
        address vault;
        uint amount;
    }

    struct LiquidityPosition {
        address positionManager;
        uint tokenId;
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
        LiquidityZapParams[] liquidityZaps;
    }

    function invest(
        InvestParams memory _params
    ) public returns (
        uint[] memory dcaPositionIds,
        VaultPosition[] memory vaultPositions,
        LiquidityPosition[] memory liquidityPositions
    ) {
        dcaPositionIds = investInDca(
            DcaInvestmentParams({
                dca: _params.dca,
                dcaInvestments: _params.dcaInvestments,
                inputToken: _params.inputToken,
                amount: _params.amount,
                zapManager: _params.zapManager,
                swaps: _params.dcaSwaps
            })
        );

        vaultPositions = investInVaults(
            VaultInvestmentParams({
                vaultManager: _params.vaultManager,
                vaultInvestments: _params.vaultInvestments,
                inputToken: _params.inputToken,
                amount: _params.amount,
                zapManager: _params.zapManager,
                swaps: _params.vaultSwaps
            })
        );

        liquidityPositions = investInLiquidity(
            LiquidityInvestParams({
                treasury: _params.treasury,
                liquidityManager: _params.liquidityManager,
                liquidityInvestments: _params.liquidityInvestments,
                inputToken: _params.inputToken,
                amount: _params.amount,
                zaps: _params.liquidityZaps
            })
        );
    }

    function investInDca(
        DcaInvestmentParams memory _params
    ) internal returns (uint[] memory) {
        if (_params.dcaInvestments.length == 0)
            return new uint[](0);

        if (_params.dcaInvestments.length != _params.swaps.length)
            revert InvalidParamsLength();

        uint[] memory dcaPositionIds = new uint[](_params.dcaInvestments.length);
        uint nextDcaPositionId = _params.dca.getPositionsLength(address(this));

        for (uint i; i < _params.dcaInvestments.length; ++i) {
            DcaInvestment memory investment = _params.dcaInvestments[i];
            IERC20Upgradeable poolInputToken = IERC20Upgradeable(_params.dca.getPool(investment.poolId).inputToken);

            uint swapOutput = _params.zapManager.zap(
                _params.swaps[i],
                _params.inputToken,
                poolInputToken,
                _params.amount * investment.percentage / 100
            );

            poolInputToken.safeIncreaseAllowance(address(_params.dca), swapOutput);

            _params.dca.depositUsingStrategy(investment.poolId, investment.swaps, swapOutput);

            dcaPositionIds[i] = nextDcaPositionId;
            ++nextDcaPositionId;
        }

        return dcaPositionIds;
    }

    function investInVaults(
        VaultInvestmentParams memory _params
    ) internal returns (VaultPosition[] memory) {
        if (_params.vaultInvestments.length == 0)
            return new VaultPosition[](0);

        if (_params.vaultInvestments.length != _params.swaps.length)
            revert InvalidParamsLength();

        VaultPosition[] memory vaultPositions = new VaultPosition[](_params.vaultInvestments.length);

        for (uint i; i < _params.vaultInvestments.length; ++i) {
            VaultInvestment memory investment = _params.vaultInvestments[i];
            IBeefyVaultV7 vault = IBeefyVaultV7(investment.vault);
            IERC20Upgradeable vaultWantToken = vault.want();

            uint swapOutput = _params.zapManager.zap(
                _params.swaps[i],
                _params.inputToken,
                vaultWantToken,
                _params.amount * investment.percentage / 100
            );

            vaultWantToken.safeIncreaseAllowance(address(_params.vaultManager), swapOutput);

            uint initialBalance = vault.balanceOf(address(this));
            _params.vaultManager.depositUsingStrategy(investment.vault, swapOutput);
            vaultPositions[i] = VaultPosition(
                investment.vault,
                vault.balanceOf(address(this)) - initialBalance
            );
        }

        return vaultPositions;
    }

    function investInLiquidity(
        LiquidityInvestParams memory _params
    ) internal returns (LiquidityPosition[] memory) {
        if (_params.liquidityInvestments.length == 0)
            return new LiquidityPosition[](0);

        if (_params.liquidityInvestments.length != _params.zaps.length)
            revert InvalidParamsLength();

        LiquidityPosition[] memory liquidityPositions = new LiquidityPosition[](_params.liquidityInvestments.length);

        for (uint i; i < _params.liquidityInvestments.length; ++i) {
            // todo test gas cost without creating the variables and accessing the index everytime
            LiquidityInvestment memory investment = _params.liquidityInvestments[i];
            LiquidityZapParams memory zap = _params.zaps[i];

            _params.liquidityManager.addLiquidityV3UsingStrategy(
                LiquidityManager.AddLiquidityV3Params({
                    positionManager: investment.positionManager,
                    inputToken: _params.inputToken,
                    token0: investment.token0,
                    token1: investment.token1,
                    fee: investment.fee,
                    depositAmountInputToken: _params.amount * investment.percentage / 100,
                    swapToken0: zap.swapToken0,
                    swapToken1: zap.swapToken1,
                    swapAmountToken0: zap.swapAmountToken0,
                    swapAmountToken1: zap.swapAmountToken1,
                    tickLower: zap.tickLower,
                    tickUpper: zap.tickUpper,
                    amount0Min: zap.amount0Min,
                    amount1Min: zap.amount1Min,
                    zapToken0: zap.zapToken0,
                    zapToken1: zap.zapToken1
                })
            );
        }

        _params.liquidityManager.sendDust(_params.inputToken, _params.treasury);

        return liquidityPositions;
    }

    struct ClosePositionParams {
        // dca
        DollarCostAverage dca;
        uint[] dcaPositions;
        // vaults
        VaultPosition[] vaultPositions;
    }

    function closePosition(ClosePositionParams memory _params) public returns (
        uint[][] memory dcaWithdrawnAmounts,
        uint[] memory vaultWithdrawnAmounts
    ) {
        return (
            _closeDcaPositions(_params.dca, _params.dcaPositions),
            _closeVaultPositions(_params.vaultPositions)
        );
    }

    function _closeDcaPositions(
        DollarCostAverage dca,
        uint[] memory dcaPositions
    ) internal returns (uint[][] memory) {
        uint[][] memory dcaWithdrawnAmounts = new uint[][](dcaPositions.length);

        for (uint i; i < dcaPositions.length; ++i) {
            DollarCostAverage.PositionInfo memory dcaPosition = dca.getPosition(
                address(this),
                dcaPositions[i]
            );
            DollarCostAverage.PoolInfo memory poolInfo = dca.getPool(dcaPosition.poolId);
            IERC20Upgradeable inputToken = IERC20Upgradeable(poolInfo.inputToken);
            IERC20Upgradeable outputToken = IERC20Upgradeable(poolInfo.outputToken);
            uint initialInputTokenBalance = inputToken.balanceOf(address(this));
            uint initialOutputTokenBalance = outputToken.balanceOf(address(this));

            dca.withdrawAll(dcaPositions[i]);

            uint inputTokenAmount = inputToken.balanceOf(address(this)) - initialInputTokenBalance;
            uint outputTokenAmount = outputToken.balanceOf(address(this)) - initialOutputTokenBalance;

            if (inputTokenAmount > 0 || outputTokenAmount > 0) {
                dcaWithdrawnAmounts[i] = new uint[](2);

                if (inputTokenAmount > 0) {
                    dcaWithdrawnAmounts[i][0] = inputTokenAmount;
                    inputToken.safeTransfer(msg.sender, inputTokenAmount);
                }

                if (outputTokenAmount > 0) {
                    dcaWithdrawnAmounts[i][1] = outputTokenAmount;
                    outputToken.safeTransfer(msg.sender, outputTokenAmount);
                }
            }
        }

        return dcaWithdrawnAmounts;
    }

    function _closeVaultPositions(
        VaultPosition[] memory _vaultPositions
    ) internal returns (uint[] memory) {
        uint[] memory vaultsWithdrawnAmounts = new uint[](_vaultPositions.length);

        for (uint i; i < _vaultPositions.length; ++i) {
            VaultPosition memory vaultPosition = _vaultPositions[i];
            IBeefyVaultV7 vault = IBeefyVaultV7(vaultPosition.vault);

            uint initialBalance = vault.want().balanceOf(address(this));

            vault.withdraw(vaultPosition.amount);

            uint withdrawnAmount = vault.want().balanceOf(address(this)) - initialBalance;

            if (withdrawnAmount > 0) {
                vaultsWithdrawnAmounts[i] = withdrawnAmount;
                vault.want().safeTransfer(msg.sender, withdrawnAmount);
            }
        }

        return vaultsWithdrawnAmounts;
    }
}
