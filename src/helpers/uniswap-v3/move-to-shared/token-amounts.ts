import JSBI from 'jsbi'
import { type BigintIsh } from '@uniswap/sdk-core'
import { type Pool, Position, FullMath, SqrtPriceMath, TickMath, maxLiquidityForAmounts } from '@uniswap/v3-sdk'
import { BigNumber } from '@ryze-blockchain/ethereum'

/**
 * Returns the minimum token0 and token1 amounts that must be sent in order to
 * safely mint a position using the provided amount of liquidity.
 *
 * @param amount0 - The available amount of token0 to invest.
 * @param amount1 - The available amount of token1 to invest.
 * @param pool - The pool used to mint the position.
 * @param tickLower - The target tick lower.
 * @param tickUpper - The target tick upper.
 */
export function getMintTokenAmounts(
    pool: Pool,
    amount0: BigintIsh,
    amount1: BigintIsh,
    tickLower: number,
    tickUpper: number,
): { amount0: JSBI, amount1: JSBI } {
    // Create a mock position instance in order to reuse Uniswap SDK logic to compute amounts
    const mockPosition = Position.fromAmounts({
        pool,
        amount0,
        amount1,
        tickLower,
        tickUpper,
        useFullPrecision: true,
    })

    return mockPosition.mintAmounts
}

export function getMintTokenFromAmount(
    pool: Pool,
    amount0: BigintIsh,
    amount1: BigintIsh,
    tickLower: number,
    tickUpper: number,
    // fromAmountFunction: 'fromAmount0' | 'fromAmount1',
): { amount0: JSBI, amount1: JSBI } {
    const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(amount0 ? tickLower : TickMath.MAX_TICK)
    const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(amount1 ? tickUpper : TickMath.MIN_TICK)

    const liquidity = maxLiquidityForAmounts(
        pool.sqrtRatioX96,
        sqrtRatioAX96,
        sqrtRatioBX96,
        amount0,
        amount1,
        true,
    )

    // Create a mock position instance in order to reuse Uniswap SDK logic to compute amounts
    // const mockPosition = fromAmountFunction === 'fromAmount0'
    //     ? Position.fromAmount0({
    //         pool,
    //         amount0: amount,
    //         tickLower,
    //         tickUpper,
    //         useFullPrecision: true,
    //     })
    //     : Position.fromAmount1({
    //         pool,
    //         amount1: amount,
    //         tickLower,
    //         tickUpper,
    //     })

    return new Position({
        pool,
        liquidity,
        tickLower,
        tickUpper,
    }).mintAmounts
}

export const getTokenAmountsFromDepositAmountUSD = (
    depositAmountUsd: string | number,
    token0Price: BigNumber,
    token1Price: BigNumber,
    currentPrice: string | number,
    priceLower: string | number,
    priceUpper: string | number,
): { amount0: BigNumber, amount1: BigNumber } => {
    const ZERO = new BigNumber(0)
    const ONE = new BigNumber(1)
    const sqrtCurrentPrice = new BigNumber(currentPrice).sqrt()
    const sqrtLowerPrice = new BigNumber(priceLower).sqrt()
    const sqrtUpperPrice = new BigNumber(priceUpper).sqrt()

    const deltaL = new BigNumber(depositAmountUsd).div(
        token1Price.times(
            sqrtCurrentPrice.minus(sqrtLowerPrice),
        ).plus(
            token0Price.times(ONE.div(sqrtCurrentPrice).minus(ONE.div(sqrtUpperPrice))),
        ),
    )

    let amount0: BigNumber
    let amount1: BigNumber

    if (currentPrice >= priceUpper) {
        amount0 = ZERO
        amount1 = deltaL.times(sqrtUpperPrice.minus(sqrtLowerPrice))
    }

    else if (currentPrice < priceLower) {
        amount0 = deltaL.times(ONE.div(sqrtLowerPrice).minus(ONE.div(sqrtUpperPrice)))
        amount1 = ZERO
    }

    else {
        amount0 = deltaL.times(ONE.div(sqrtCurrentPrice).minus(ONE.div(sqrtUpperPrice)))
        amount1 = deltaL.times(sqrtCurrentPrice.minus(sqrtLowerPrice))
    }

    return { amount0, amount1 }
}

export const sqrtRatioX96FromTick = (tick: number) => {
    return TickMath.getSqrtRatioAtTick(tick)
}

export const calculateLiquidity = (
    amountUSD: number | string,
    sqrtRatioAX96: JSBI,
    sqrtRatioBX96: JSBI,
) => {
    return FullMath.mulDivRoundingUp(
        JSBI.BigInt(amountUSD),
        JSBI.subtract(sqrtRatioBX96, sqrtRatioAX96),
        sqrtRatioBX96,
    )
}

export const calculateTokenAmounts = (
    liquidity: JSBI,
    sqrtRatioX96: JSBI,
    sqrtRatioAX96: JSBI,
    sqrtRatioBX96: JSBI,
) => {
    const amount0 = SqrtPriceMath.getAmount0Delta(sqrtRatioAX96, sqrtRatioX96, liquidity, true)
    const amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioX96, sqrtRatioBX96, liquidity, true)

    return { amount0, amount1 }
}

export function getTokenAmountsFromLiquidityUsd(
    amountUsd: number | string,
    tickLower: number,
    tickUpper: number,
) {
    const sqrtRatioAX96 = sqrtRatioX96FromTick(tickLower)
    const sqrtRatioBX96 = sqrtRatioX96FromTick(tickUpper)

    const liquidity = calculateLiquidity(
        amountUsd,
        sqrtRatioAX96,
        sqrtRatioBX96,
    )

    const amount0 = SqrtPriceMath.getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity, false)
    const amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, liquidity, false)

    return { amount0, amount1 }
}
