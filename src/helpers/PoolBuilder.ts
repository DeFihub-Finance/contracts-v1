import { connectors, stablecoins as stablecoinsByChainId, tokenAddresses } from '@defihub/shared'
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
        const [
            chainId,
            possiblePools,
            tokensByAddress,
        ] = await Promise.all([
            getChainId(),
            PoolBuilder._generateAllPossibleUniquePools(),
            PoolBuilder._getTokens(),
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

    private static async _getTokens() {
        const chainId = await getChainId()
        // must force type because tokenAddresses uses as const
        const addresses = tokenAddresses[chainId as keyof typeof tokenAddresses]

        if (!addresses)
            throw new Error(EthErrors.UNSUPPORTED_CHAIN)

        return API.getTokens(Object.values(addresses).map(address => ({ chainId, address })))
    }

    private static async _generateAllPossibleUniquePools(): Promise<PoolTokens[]> {
        const chainId = await getChainId()
        const pairs: PoolTokens[] = []
        const seenPairs = new Set<string>()
        const allTokens = Object.values(tokenAddresses[chainId as keyof typeof tokenAddresses])
        const stablecoins: readonly string[] = stablecoinsByChainId[chainId as keyof typeof stablecoinsByChainId]

        for (const connectorToken of connectors[chainId as keyof typeof connectors]) {
            for (const genericToken of allTokens) {
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
