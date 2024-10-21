import { createArrayOfIndexes, exchangesMeta } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { PreparedTransactionRequest } from 'ethers'
import hre from 'hardhat'
import { DollarCostAverage__factory } from '@src/typechain'
import { findAddressOrFail, getChainId } from '@src/helpers'
import { PoolBuilder } from '@src/helpers/PoolBuilder'
import { proposeTransactions } from '@src/helpers/safe'

async function updatePools() {
    const chainId = await getChainId()
    const swaps = await PoolBuilder.buildPools(new BigNumber(250), new BigNumber(0.02))
    const dcaContract = DollarCostAverage__factory.connect(
        await findAddressOrFail('DollarCostAverage'),
        (await hre.ethers.getSigners())[0],
    )
    const transactions: PreparedTransactionRequest[] = []

    const availablePools = await Promise.all(
        createArrayOfIndexes(await dcaContract.getPoolsLength())
            .map(async pid => {
                const pool = await dcaContract.getPool(pid)

                return {
                    pid,
                    inputToken: pool.inputToken.toLowerCase(),
                    outputToken: pool.outputToken.toLowerCase(),
                    router: pool.router.toLowerCase(),
                    path: pool.path.toLowerCase(),
                }
            }),
    )

    await Promise.all(
        availablePools.map(async ({ pid, inputToken, outputToken, router, path }) => {
            const matchingSwap = swaps
                .find(swap => inputToken === swap.path.inputToken && outputToken === swap.path.outputToken)

            if (!matchingSwap)
                throw new Error('Swap not found')

            const swapExchange = exchangesMeta[chainId]
                ?.find(exchange => exchange.protocol === matchingSwap.protocol)
            const contractExchange = exchangesMeta[chainId]
                ?.find(exchange => exchange.router === router)

            if (!swapExchange)
                throw new Error('Swap exchange not found')

            if (!contractExchange)
                throw new Error('Contract exchange not found')

            const matchingSwapEncodedPath = (await matchingSwap.path.encodedPath()).toLowerCase()

            if (
                swapExchange.router !== contractExchange.router ||
                matchingSwapEncodedPath !== path
            ) {
                transactions.push(
                    await dcaContract.setPoolRouterAndPath.populateTransaction(
                        pid,
                        swapExchange.router,
                        matchingSwapEncodedPath,
                    ),
                )
            }
        }),
    )

    await proposeTransactions(chainId, transactions)
}

updatePools()
