import { BigNumber } from '@ryze-blockchain/ethereum'

export * from './dca'
export * from './strategies.mock'
export * from './prices.mock'

export const ONE_PERCENT = new BigNumber(0.01)

// TODO move to shared
export enum FeeType {
    PROTOCOL,
    STRATEGIST,
    REFERRER,
}
