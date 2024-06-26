import JSBI from 'jsbi'
import { type BigintIsh } from '@uniswap/sdk-core'
import { type Pool, Position, FullMath, SqrtPriceMath, TickMath } from '@uniswap/v3-sdk'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { parseUnits } from 'ethers'

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

function splitAmounts(
    amountInputToken: BigNumber,
    ratio: BigNumber,
    price0: BigNumber,
    price1: BigNumber,
): { amount0: bigint, amount1: bigint } {
    const amount0 = amountInputToken.div(ratio.plus(1))
    const amount1 = ratio.times(amount0)

    return {
        amount0: BigInt(amount0.div(price0).toFixed(0)),
        amount1: BigInt(amount1.div(price1).toFixed(0)),
    }
}

export function getAmounts(
    amountInputToken: bigint,
    pool: Pool,
    tickLower: number,
    tickUpper: number,
    price0: BigNumber,
    price1: BigNumber,
): { amount0: bigint, amount1: bigint } {
    const amountInputTokenBn = new BigNumber(amountInputToken.toString())

    if (pool.tickCurrent <= tickLower) {
        return {
            amount0: BigInt(amountInputTokenBn.div(price0).toFixed(0)),
            amount1: BigInt(0),
        }
    }

    if (pool.tickCurrent >= tickUpper) {
        return {
            amount0: BigInt(0),
            amount1: BigInt(amountInputTokenBn.div(price1).toFixed(0)),
        }
    }

    const { amount0, amount1 } = Position.fromAmount0({
        pool,
        tickLower,
        tickUpper,
        amount0: parseUnits('1', 18).toString(),
        useFullPrecision: true,
    }).mintAmounts

    const ratio = new BigNumber(amount1.toString()).times(price1)
        .div(new BigNumber(amount0.toString()).times(price0))

    return splitAmounts(
        amountInputTokenBn,
        ratio,
        price0,
        price1,
    )
}

export function getMintTokenFromAmount(
    pool: Pool,
    amount0: BigintIsh,
    tickLower: number,
    tickUpper: number,
): { amount0: JSBI, amount1: JSBI } {
    const baseAmount0 = parseUnits('1', 18)

    const midPosition = Position.fromAmount0({
        pool,
        tickLower,
        tickUpper,
        amount0: baseAmount0.toString(),
        useFullPrecision: true,
    }).mintAmounts

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
