import { BigNumber } from '@ryze-blockchain/ethereum'

export * from './dca'
export * from './strategies.mock'
export * from './prices.mock'

export const ONE_PERCENT = new BigNumber(0.01)

// TODO move to shared
export const FeeOperations = {
    STRATEGY_DEPOSIT: 0,
    LIQUIDITY_FEES: 1,
}

export type FeeOperation = typeof FeeOperations[keyof typeof FeeOperations]

export const MINUTE_IN_SECONDS = 60
export const HOUR_IN_SECONDS = 60 * MINUTE_IN_SECONDS
export const DAY_IN_SECONDS = 24 * HOUR_IN_SECONDS
export const YEAR_IN_SECONDS = 365 * DAY_IN_SECONDS
