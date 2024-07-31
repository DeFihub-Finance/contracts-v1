import { BigNumber } from '@ryze-blockchain/ethereum'
import { ERC20Priced, Slippage, UniswapFactoryV3, UniswapV3, UseFee } from '@defihub/shared'
import { InvestLib } from '@src/typechain/artifacts/contracts/StrategyManager'
import { UniswapV3ZapHelper } from './zap'
import { UniswapV3 as UniswapV3Helper } from './UniswapV3'
import { UniswapPositionManager, UniswapV3Factory } from '@src/typechain'
import { AddressLike } from 'ethers'

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
        factory: UniswapFactoryV3,
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
            new BigNumber((amount * investment.percentage / 100n).toString()),
            pool,
            token0.price,
            token1.price,
            Number(investment.lowerPricePercentage),
            Number(investment.upperPricePercentage),
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            LiquidityHelpers.getEncodedSwap(
                swapAmountToken0,
                inputToken.address,
                token0.address,
                pool.fee,
                inputToken.price,
                token0.price,
                slippage,
                liquidityManager,
            ),
            LiquidityHelpers.getEncodedSwap(
                swapAmountToken1,
                inputToken.address,
                token1.address,
                pool.fee,
                inputToken.price,
                token1.price,
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

        if (!amount || inputToken === outputToken)
            return '0x'

        return UniswapV3ZapHelper.encodeExactInputSingle(...args)
    }

    public static async getLiquidityPositionInfo(
        position: InvestLib.LiquidityPositionStructOutput,
        positionManager: UniswapPositionManager,
        factory: UniswapV3Factory,
        recipient: AddressLike,
        from?: AddressLike,
    ) {
        const [
            {
                token0,
                token1,
                fee,
                tickLower,
                tickUpper,
            },
            fees,
        ] = await Promise.all([
            positionManager.positions(position.tokenId),
            UniswapV3Helper.getPositionFees(
                position.tokenId,
                positionManager,
                recipient,
                from,
            ),
        ])

        const { amount0, amount1 } = UniswapV3Helper.getPositionTokenAmounts(
            await UniswapV3Helper.getPoolByFactoryContract(factory, token0, token1, fee),
            {
                liquidity: position.liquidity,
                tickLower,
                tickUpper,
            },
        )

        return {
            token0,
            token1,
            amount0,
            amount1,
            fees,
        }
    }
}
