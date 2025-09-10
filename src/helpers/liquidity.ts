import { ethers } from 'hardhat'
import { AddressLike } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { ERC20Priced, FeeTo, PathUniswapV3, Slippage, UniswapV3 } from '@defihub/shared'
import { StrategyStorage } from '@src/typechain/artifacts/contracts/StrategyManager'
import {
    NonFungiblePositionManager,
    NonFungiblePositionManager__factory,
    StrategyManager__v4,
    UniswapV3Factory,
    UniversalRouter,
    UseFee,
} from '@src/typechain'
import { UniswapV3 as UniswapV3Helper } from './UniswapV3'
import { SwapEncoder } from '@src/helpers/SwapEncoder'
import { ONE_PERCENT } from '@src/constants'

export class LiquidityHelpers {
    private static readonly ONE_HUNDRED_PERCENT_IN_BP = BigInt(1e6)

    public static getMinOutput(
        amount: bigint,
        inputToken: ERC20Priced,
        outputToken: ERC20Priced,
        slippage: BigNumber = ONE_PERCENT,
    ) {
        if (outputToken.address === inputToken.address)
            return Slippage.deductSlippage(amount, slippage)

        return Slippage.getMinOutput(
            amount,
            inputToken,
            outputToken,
            slippage.times(2), // Mul by 2 since we first need to swap on liquidity investments.
        )
    }

    public static async getLiquidityZap(
        universalRouter: UniversalRouter,
        amount: bigint,
        investment: StrategyStorage.LiquidityInvestmentStructOutput,
        inputToken: ERC20Priced,
        token0: ERC20Priced,
        token1: ERC20Priced,
        factory: UniswapV3Factory,
        liquidityManager: UseFee,
        slippage = ONE_PERCENT,
    ) {
        const pool = await UniswapV3Helper.getPoolByFactoryContract(
            factory,
            token0.address,
            token1.address,
            investment.fee,
        )

        const {
            swapAmountToken0,
            swapAmountToken1,
            tickLower,
            tickUpper,
        } = UniswapV3.getMintPositionInfo(
            inputToken,
            new BigNumber((amount * investment.percentage / 100n).toString()).shiftedBy(-inputToken.decimals),
            pool,
            token0.price,
            token1.price,
            LiquidityHelpers.parsePricePercentage(investment.lowerBound),
            LiquidityHelpers.parsePricePercentage(investment.upperBound),
            true,
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            inputToken.address === token0.address || swapAmountToken0 === 0n
                ? '0x'
                : SwapEncoder.encodeExactInputV3(
                    universalRouter,
                    swapAmountToken0,
                    new PathUniswapV3(inputToken.address, [{ fee: pool.fee, token: token0.address }]),
                    inputToken,
                    token0,
                    slippage,
                    liquidityManager,
                ),
            inputToken.address === token1.address || swapAmountToken1 === 0n
                ? '0x'
                : SwapEncoder.encodeExactInputV3(
                    universalRouter,
                    swapAmountToken1,
                    new PathUniswapV3(inputToken.address, [{ fee: pool.fee, token: token1.address }]),
                    inputToken,
                    token1,
                    slippage,
                    liquidityManager,
                ),
        ])

        return {
            amount0Min: LiquidityHelpers.getMinOutput(swapAmountToken0, inputToken, token0),
            amount1Min: LiquidityHelpers.getMinOutput(swapAmountToken1, inputToken, token1),
            swapAmountToken0,
            swapAmountToken1,
            swapToken0,
            swapToken1,
            tickLower,
            tickUpper,
        }
    }

    // TODO update on shared (UniswapV3.getPositionFees)
    public static async getDeductedPositionFees(
        tokenId: bigint,
        liquidityRewardFeeBP: bigint,
        positionManager: NonFungiblePositionManager,
        from: AddressLike,
    ): Promise<{ amount0: bigint, amount1: bigint }> {
        const { amount0, amount1 } = await UniswapV3.getPositionFees(
            tokenId,
            positionManager.connect(ethers.provider),
            from,
        )

        const amountMinusFees0 = amount0 - (amount0 * liquidityRewardFeeBP / this.ONE_HUNDRED_PERCENT_IN_BP)
        const amountMinusFees1 = amount1 - (amount1 * liquidityRewardFeeBP / this.ONE_HUNDRED_PERCENT_IN_BP)

        return {
            amount0: amountMinusFees0,
            amount1: amountMinusFees1,
        }
    }

    public static async getPositionFeeAmounts(
        strategyId: bigint,
        positionId: bigint,
        investor: AddressLike,
        strategyManager: StrategyManager__v4,
    ) {
        const [
            strategistRewardFeeSplit,
            strategyLiquidityFee,
            { liquidityPositions },
        ] = await Promise.all([
            strategyManager.getStrategistRewardFeeSplitBP(),
            strategyManager.getLiquidityRewardFee(strategyId),
            strategyManager.getPositionInvestments(investor, positionId),
        ])

        return Promise.all(liquidityPositions.map(async position => {
            const positionManager = NonFungiblePositionManager__factory.connect(position.positionManager, ethers.provider)

            const [
                { token0, token1 },
                { amount0, amount1 },
            ] = await Promise.all([
                positionManager.positions(position.tokenId),
                UniswapV3.getPositionFees(position.tokenId, positionManager, strategyManager),
            ])

            const total0 = amount0 * strategyLiquidityFee / this.ONE_HUNDRED_PERCENT_IN_BP
            const total1 = amount1 * strategyLiquidityFee / this.ONE_HUNDRED_PERCENT_IN_BP
            const strategist0 = total0 * strategistRewardFeeSplit / this.ONE_HUNDRED_PERCENT_IN_BP
            const strategist1 = total1 * strategistRewardFeeSplit / this.ONE_HUNDRED_PERCENT_IN_BP
            const protocol0 = total0 - strategist0
            const protocol1 = total1 - strategist1

            return {
                tokens: [token0, token1],
                amountsByFeeTo: {
                    [FeeTo.PROTOCOL]: [protocol0, protocol1],
                    [FeeTo.STRATEGIST]: [strategist0, strategist1],
                },
            }
        }))
    }

    public static async getLiquidityPositionInfo(
        tokenId: bigint,
        liquidityRewardFeeBP: bigint,
        positionManager: NonFungiblePositionManager,
        factory: UniswapV3Factory,
        from: AddressLike,
    ) {
        const [
            {
                token0,
                token1,
                fee,
                liquidity,
                tickLower,
                tickUpper,
            },
            fees,
        ] = await Promise.all([
            positionManager.positions(tokenId),
            this.getDeductedPositionFees(
                tokenId,
                liquidityRewardFeeBP,
                positionManager,
                from,
            ),
        ])

        const { amount0, amount1 } = UniswapV3.getPositionTokenAmounts(
            await UniswapV3Helper.getPoolByFactoryContract(factory, token0, token1, fee),
            liquidity,
            tickLower,
            tickUpper,
        )

        return {
            token0,
            token1,
            amount0,
            amount1,
            fees,
        }
    }

    public static parsePricePercentage(value: bigint) {
        return new BigNumber(value.toString())
            .shiftedBy(-UniswapV3.PRICE_PERCENTAGE_DECIMALS)
    }
}
