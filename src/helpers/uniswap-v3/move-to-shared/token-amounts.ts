import { type Pool, Position } from '@uniswap/v3-sdk'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { parseUnits } from 'ethers'

export function getAmounts(
    depositAmountUsd: bigint,
    pool: Pool,
    tickLower: number,
    tickUpper: number,
    price0: BigNumber,
    price1: BigNumber,
): { amount0: bigint, amount1: bigint } {
    const depositAmountUsdBn = new BigNumber(depositAmountUsd.toString())

    if (pool.tickCurrent <= tickLower) {
        return {
            amount0: BigInt(depositAmountUsdBn.div(price0).toFixed(0)),
            amount1: BigInt(0),
        }
    }

    if (pool.tickCurrent >= tickUpper) {
        return {
            amount0: BigInt(0),
            amount1: BigInt(depositAmountUsdBn.div(price1).toFixed(0)),
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

    const amount0Usd = depositAmountUsdBn.div(ratio.plus(1))
    const amount1Usd = ratio.times(amount0Usd)

    return {
        amount0: BigInt(amount0Usd.div(price0).toFixed(0)),
        amount1: BigInt(amount1Usd.div(price1).toFixed(0)),
    }
}
