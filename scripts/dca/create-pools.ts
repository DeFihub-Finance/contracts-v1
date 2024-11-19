import { exchangesMeta, PathUniswapV3, SwapUniswapV3, TokenKeys, unwrapAddressLike } from '@defihub/shared'
import { BigNumber, chainRegistry, notEmpty } from '@ryze-blockchain/ethereum'
import { proposeTransactions } from '@src/helpers/safe'
import { PreparedTransactionRequest } from 'ethers'
import hre from 'hardhat'
import { DollarCostAverage__factory } from '@src/typechain'
import { findAddressOrFail, invertPathUniswapV3, sendTransaction } from '@src/helpers'
import { PoolBuilder } from '@src/helpers/PoolBuilder'
import { bnbTestnetDcaPools } from '@src/constants'
import { getChainId } from '@src/helpers/chain-id'

const interval = (24 * 60 * 60).toString() // 24 hours
const selectTokens: Partial<Record<TokenKeys, string>> | undefined = {
    ape: '0x7f9fbf9bdd3f4105c478b996b648fe6e828a1e98',
    w: '0xb0ffa8000886e57f86dd5264b9582b2ad87b2b91',
    cake: '0x1b896893dfc86bb67cf57767298b9073d2c1ba2c',
    comp: '0x354a6da3fcde098f8389cad84b0182725c6c91de',
    aave: '0xba5ddd1f9d7f570dc94a51479a000e3bce967196',
}

async function getDcaContract() {
    return DollarCostAverage__factory.connect(
        await findAddressOrFail('DollarCostAverage'),
        (await hre.ethers.getSigners())[0],
    )
}

async function filterSwaps(swaps: SwapUniswapV3[]) {
    if (!selectTokens)
        return swaps

    const selectedTokensArray = Object.values(selectTokens)

    return (await Promise.all(
        swaps.map(async swap => {
            const inputToken = await unwrapAddressLike(swap.path.inputToken)
            const outputToken = await unwrapAddressLike(swap.path.outputToken)

            return selectedTokensArray.includes(inputToken) || selectedTokensArray.includes(outputToken)
                ? swap
                : null
        }),
    )).filter(notEmpty)
}

async function createProposal() {
    const chainId = await getChainId()
    const swaps = await PoolBuilder.buildPools(new BigNumber(250), new BigNumber(0.02))
    const filteredSwaps = await filterSwaps(swaps)
    const dcaContract = await getDcaContract()
    const transactions: PreparedTransactionRequest[] = []

    for (const swap of filteredSwaps) {
        const routerAddress = exchangesMeta[chainId]
            ?.find(exchange => exchange.protocol === swap.protocol)
            ?.router

        if (!routerAddress) {
            console.error(`No router found for chain ${ chainId }`)

            continue
        }

        transactions.push(
            await dcaContract.createPool.populateTransaction(
                await unwrapAddressLike(swap.path.inputToken),
                await unwrapAddressLike(swap.path.outputToken),
                routerAddress,
                await swap.path.encodedPath(),
                interval,
            ),
        )
    }

    await proposeTransactions(chainId, transactions)
}

async function sendTestnetTransaction() {
    const [deployer] = await hre.ethers.getSigners()
    const contract = await getDcaContract()
    const routerAddress = await findAddressOrFail('UniswapRouterV3')
    const pools = [
        ...bnbTestnetDcaPools,
        ...bnbTestnetDcaPools.map(invertPathUniswapV3),
    ]

    for (const pool of pools) {
        const path = new PathUniswapV3(
            pool.inputToken,
            [{ token: pool.outputToken, fee: 3000 }],
        )

        try {
            await sendTransaction(
                await contract.createPool.populateTransaction(
                    pool.inputToken,
                    pool.outputToken,
                    routerAddress,
                    await path.encodedPath(),
                    interval,
                ),
                deployer,
            )
        }
        catch (e) {
            console.log(
                'error sending transaction:',
                contract.interface.parseError((e as { data: string }).data),
            )
        }
    }
}

async function createPools() {
    chainRegistry[await getChainId()].testnet
        ? await sendTestnetTransaction()
        : await createProposal()
}

createPools()
