import { BigNumber } from '@ryze-blockchain/ethereum'

export const USD_PRICE_BN = new BigNumber(1)
export const BTC_PRICE = 70_000n
export const BTC_PRICE_BN = new BigNumber(BTC_PRICE.toString())
export const ETH_PRICE = 10_000n
export const ETH_PRICE_BN = new BigNumber(ETH_PRICE.toString())

export const USD_QUOTE = { price: USD_PRICE_BN, decimals: 18 }
export const BTC_QUOTE = { price: BTC_PRICE_BN, decimals: 18 }
export const ETH_QUOTE = { price: ETH_PRICE_BN, decimals: 18 }
