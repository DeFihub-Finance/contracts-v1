import { PathUniswapV3, unwrapAddressLike } from '@defihub/shared'
import { ethers } from 'hardhat'
import { getTokenPrices } from './get-token-price'
import { Chain } from '@ryze-blockchain/ethereum'

export async function getPoolsTokenPrices(pools: PathUniswapV3[]) {
    const tokenAddresses = await getAllTokens(pools)
    const chainId = Chain.parseChainIdOrFail((await ethers.provider.getNetwork()).chainId)

    return getTokenPrices(tokenAddresses.map(address => ({
        chainId,
        address,
    })))
}

export async function getAllTokens(pools: PathUniswapV3[]) {
    const allTokens = new Set<string>()

    for (const pool of pools) {
        allTokens.add((await unwrapAddressLike(pool.inputToken)))

        for (const hop of pool.hops)
            allTokens.add((await unwrapAddressLike(hop.token)))
    }

    return [...allTokens]
}
