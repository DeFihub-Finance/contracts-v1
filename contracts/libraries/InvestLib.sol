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
import {StrategyStorage} from "../abstract/StrategyStorage.sol";

library InvestLib {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    error InvalidParamsLength();
    error InsufficientFunds();

    /**
     * Invest Params structs
     *
     * Interfaces of the internal functions of the InvestLib library that are used to invest in each product
     */

    struct DcaInvestmentParams {
        DollarCostAverage dca;
        StrategyStorage.DcaInvestment[] dcaInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        ZapManager zapManager;
        bytes[] swaps;
    }

    struct VaultInvestmentParams {
        VaultManager vaultManager;
        StrategyStorage.VaultInvestment[] vaultInvestments;
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
        StrategyStorage.LiquidityInvestment[] investments;
        IERC20Upgradeable inputToken;
        uint amount;
        uint8 liquidityTotalPercentage;
        LiquidityInvestZapParams[] zaps;
    }

    struct BuyInvestParams {
        StrategyStorage.BuyInvestment[] investments;
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
        StrategyStorage.DcaInvestment[] dcaInvestments;
        bytes[] dcaSwaps;
        // vaults
        StrategyStorage.VaultInvestment[] vaultInvestments;
        bytes[] vaultSwaps;
        // liquidity
        StrategyStorage.LiquidityInvestment[] liquidityInvestments;
        LiquidityInvestZapParams[] liquidityZaps;
        uint8 liquidityTotalPercentage;
        // tokens
        StrategyStorage.BuyInvestment[] buyInvestments;
        bytes[] buySwaps;
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

    struct BuyPosition {
        IERC20Upgradeable token;
        uint amount;
    }

    function invest(
        InvestParams memory _params
    ) external returns (
        uint[] memory dcaPositionIds,
        VaultPosition[] memory vaultPositions,
        LiquidityPosition[] memory liquidityPositions,
        BuyPosition[] memory buyPositions
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

        buyPositions = _investInToken(
            BuyInvestParams({
                investments: _params.buyInvestments,
                inputToken: _params.inputToken,
                amount: _params.amount,
                zapManager: _params.zapManager,
                swaps: _params.buySwaps
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
            StrategyStorage.DcaInvestment memory investment = _params.dcaInvestments[i];
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
            StrategyStorage.VaultInvestment memory investment = _params.vaultInvestments[i];
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
            StrategyStorage.LiquidityInvestment memory investment = _params.investments[i];
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
        BuyInvestParams memory _params
    ) private returns (BuyPosition[] memory) {
        if (_params.swaps.length == 0)
            return new BuyPosition[](0);

        BuyPosition[] memory buyPositions = new BuyPosition[](_params.swaps.length);

        for (uint i; i < _params.swaps.length; ++i) {
            StrategyStorage.BuyInvestment memory investment = _params.investments[i];

            uint swapOutput = ZapLib.zap(
                _params.zapManager,
                _params.swaps[i],
                _params.inputToken,
                investment.token,
                _params.amount * investment.percentage / 100
            );

            buyPositions[i] = BuyPosition(investment.token, swapOutput);
        }

        return buyPositions;
    }
}
