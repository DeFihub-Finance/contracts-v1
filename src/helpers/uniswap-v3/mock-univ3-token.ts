import { Token } from '@uniswap/sdk-core'
import { ChainIds } from '@ryze-blockchain/ethereum'

export function mockUniV3Token(address: string, decimals: number | bigint) {
    if (typeof decimals === 'bigint')
        decimals = Number(decimals)

    return new Token(ChainIds.ETH, address, decimals)
}
