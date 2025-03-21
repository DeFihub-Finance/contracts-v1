import { BigNumber } from '@ryze-blockchain/ethereum'

export * from './dca'
export * from './strategies.mock'
export * from './prices.mock'

export const ONE_PERCENT = new BigNumber(0.01)

// TODO move to shared
export const FeeTo = {
    PROTOCOL: 0n,
    STRATEGIST: 1n,
    REFERRER: 2n,
} as const

export type FeeToType = typeof FeeTo[keyof typeof FeeTo]
