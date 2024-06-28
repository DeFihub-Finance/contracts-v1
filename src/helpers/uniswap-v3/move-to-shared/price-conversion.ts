import JSBI from 'jsbi'
import { Price, Token } from '@uniswap/sdk-core'
import {
    FeeAmount,
    TICK_SPACINGS,
    TickMath,
    encodeSqrtRatioX96,
    nearestUsableTick,
    priceToClosestTick,
} from '@uniswap/v3-sdk'

const numericStringRegex = /^\d*\.?\d+$/

export function parseToPriceRatio(baseToken: Token, quoteToken: Token, value: string) {
    if (!value.match(numericStringRegex))
        value = '0'

    const [whole, fraction] = value.split('.')

    const decimals = fraction?.length ?? 0
    const withoutDecimals = JSBI.BigInt((whole ?? '') + (fraction ?? ''))

    return new Price(
        baseToken,
        quoteToken,
        JSBI.multiply(JSBI.BigInt(10 ** decimals), JSBI.BigInt(10 ** baseToken.decimals)),
        JSBI.multiply(withoutDecimals, JSBI.BigInt(10 ** quoteToken.decimals)),
    )
}

export function parsePriceToTick(
    baseToken: Token,
    quoteToken: Token,
    feeAmount: FeeAmount,
    priceString: string,
): number {
    let tick: number

    const price = parseToPriceRatio(baseToken, quoteToken, priceString)

    // check price is within min/max bounds, if outside return min/max
    const sqrtRatioX96 = encodeSqrtRatioX96(price.numerator, price.denominator)

    if (JSBI.greaterThanOrEqual(sqrtRatioX96, TickMath.MAX_SQRT_RATIO)) {
        tick = TickMath.MAX_TICK
    }
    else if (JSBI.lessThanOrEqual(sqrtRatioX96, TickMath.MIN_SQRT_RATIO)) {
        tick = TickMath.MIN_TICK
    }
    else {
        // this function is agnostic to the base, will always return the correct tick
        tick = priceToClosestTick(price)
    }

    return nearestUsableTick(tick, TICK_SPACINGS[feeAmount])
}
