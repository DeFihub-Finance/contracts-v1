import { connectors, stablecoins as stablecoinsByChainId, tokenAddresses as _tokenAddresses } from '@defihub/shared'
import { BigNumber, EthErrors, notEmpty } from '@ryze-blockchain/ethereum'
import { getChainId } from '@src/helpers/chain-id'
import { API } from '@src/helpers/API'

interface PoolTokens {
    inputToken: string
    outputToken: string
}

export class PoolBuilder {
    public static async buildPools(
        swapAmountUSD: BigNumber,
        maxPriceImpactPercentage: BigNumber,
    ) {
        const chainId = await getChainId()
        const tokenAddressesObject = _tokenAddresses[chainId as keyof typeof _tokenAddresses]

        if (!tokenAddressesObject)
            throw new Error(EthErrors.UNSUPPORTED_CHAIN)

        const tokenAddresses = Object.values(tokenAddressesObject)

        const [
            possiblePools,
            tokensByAddress,
        ] = await Promise.all([
            PoolBuilder._generateAllPossibleUniquePools(tokenAddresses),
            PoolBuilder._getTokens(tokenAddresses),
        ])

        return (
            await Promise.all(possiblePools.map(async pool => {
                const inputToken = tokensByAddress[pool.inputToken]
                const outputToken = tokensByAddress[pool.outputToken]

                if (!inputToken)
                    throw new Error(`Token not found: ${ pool.inputToken }`)

                if (!outputToken)
                    throw new Error(`Token not found: ${ pool.outputToken }`)

                const swap = await API.getSwapPath(
                    chainId,
                    pool.inputToken,
                    pool.outputToken,
                    BigInt(swapAmountUSD.div(inputToken.price).shiftedBy(inputToken.decimals).toFixed(0)),
                )

                if (!swap)
                    return

                const swapAmountMinusPriceImpact = swapAmountUSD.minus(swapAmountUSD.times(maxPriceImpactPercentage))
                const expectedOutputValue = new BigNumber(swap.outputAmount.toString())
                    .shiftedBy(-outputToken.decimals)
                    .times(outputToken.price)

                if (expectedOutputValue.lt(swapAmountMinusPriceImpact)) {
                    const tokens = `${ inputToken.symbol } => ${ outputToken.symbol }`
                    const amountIn = swapAmountUSD.toFixed(2)
                    const amountOut = expectedOutputValue.toFixed(2)

                    console.error(`failed creating pool for: ${ tokens } | in: ${ amountIn } | out: ${ amountOut }`)

                    return
                }

                return swap
            }))
        ).filter(notEmpty)
    }

    private static async _getTokens(tokenAddresses: string[]) {
        const chainId = await getChainId()

        return API.getTokens(tokenAddresses.map(address => ({ chainId, address })))
    }

    private static async _generateAllPossibleUniquePools(tokenAddresses: string[]): Promise<PoolTokens[]> {
        const chainId = await getChainId()
        const pairs: PoolTokens[] = []
        const seenPairs = new Set<string>()
        const stablecoins: readonly string[] = stablecoinsByChainId[chainId as keyof typeof stablecoinsByChainId]

        for (const connectorToken of connectors[chainId as keyof typeof connectors]) {
            for (const genericToken of tokenAddresses) {
                if (connectorToken === genericToken)
                    continue

                // no need for stable => stable pools
                if (stablecoins.includes(genericToken) && stablecoins.includes(connectorToken))
                    continue

                const keyConnectorAsInput = `${ connectorToken }:${ genericToken }`
                const keyConnectorAsOutput = `${ genericToken }:${ connectorToken }`

                if (!seenPairs.has(keyConnectorAsInput)) {
                    pairs.push({ inputToken: connectorToken, outputToken: genericToken })
                    seenPairs.add(keyConnectorAsInput)
                }

                if (!seenPairs.has(keyConnectorAsOutput)) {
                    pairs.push({ inputToken: genericToken, outputToken: connectorToken })
                    seenPairs.add(keyConnectorAsOutput)
                }
            }
        }

        return pairs
    }
}
