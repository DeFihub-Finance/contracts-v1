import { ethers } from 'hardhat'
import { AddressLike } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { ERC20Priced, Slippage, UniswapV3 } from '@defihub/shared'
import { InvestLib } from '@src/typechain/artifacts/contracts/StrategyManager'
import { NonFungiblePositionManager, UniswapV3Factory, UseFee } from '@src/typechain'
import { UniswapV3ZapHelper } from './zap'
import { UniswapV3 as UniswapV3Helper } from './UniswapV3'

export class LiquidityHelpers {
    public static getMinOutput(
        amount: bigint,
        inputToken: ERC20Priced,
        outputToken: ERC20Priced,
        slippage: BigNumber = new BigNumber(0.01),
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
        amount: bigint,
        investment: InvestLib.LiquidityInvestmentStructOutput,
        inputToken: ERC20Priced,
        token0: ERC20Priced,
        token1: ERC20Priced,
        factory: UniswapV3Factory,
        liquidityManager: UseFee,
        slippage = new BigNumber(0.01),
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
            LiquidityHelpers.parsePricePercentage(investment.lowerPricePercentage),
            LiquidityHelpers.parsePricePercentage(investment.upperPricePercentage),
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            LiquidityHelpers.getEncodedSwap(
                swapAmountToken0,
                inputToken,
                token0,
                pool.fee,
                slippage,
                liquidityManager,
            ),
            LiquidityHelpers.getEncodedSwap(
                swapAmountToken1,
                inputToken,
                token1,
                pool.fee,
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

    public static getEncodedSwap(
        ...args: Parameters<typeof UniswapV3ZapHelper.encodeExactInputSingle>
    ) {
        const [
            amount,
            inputToken,
            outputToken,
        ] = args

        if (!amount || inputToken.address === outputToken.address)
            return '0x'

        return UniswapV3ZapHelper.encodeExactInputSingle(...args)
    }

    public static async getLiquidityPositionInfo(
        tokenId: bigint,
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
            UniswapV3.getPositionFees(
                tokenId,
                positionManager.connect(ethers.provider),
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
