import { BigNumber } from '@ryze-blockchain/ethereum'
import { ERC20Priced, UniswapFactoryV3, UniswapV3 } from '@defihub/shared'
import { UseFee } from '@src/typechain'
import { InvestLib } from '@src/typechain/artifacts/contracts/StrategyManager'
import { UniswapV3 as UniswapV3Helper } from '../UniswapV3'
import { getMinOutput } from './get-min-output'
import { getEncodedSwap } from './get-encoded-swap'

export async function getLiquidityZap(
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
        getEncodedSwap(
            'uniswapV3',
            swapAmountToken0,
            inputToken.address,
            token0.address,
            pool.fee,
            inputToken.price,
            token0.price,
            slippage,
            liquidityManager,
        ),
        getEncodedSwap(
            'uniswapV3',
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
        amount0Min: getMinOutput(swapAmountToken0, inputToken, token0),
        amount1Min: getMinOutput(swapAmountToken1, inputToken, token1),
        swapAmountToken0,
        swapAmountToken1,
        swapToken0,
        swapToken1,
        tickLower,
        tickUpper,
    }
}
