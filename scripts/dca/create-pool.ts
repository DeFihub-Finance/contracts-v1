import { PathUniswapV3, unwrapAddressLike } from '@defihub/shared'
import { Chain, BigNumber, chainRegistry } from '@ryze-blockchain/ethereum'
import { proposeTransactions } from '@src/helpers/safe'
import { PreparedTransactionRequest } from 'ethers'
import hre from 'hardhat'
import { DollarCostAverage__factory } from '@src/typechain'
import { API, findAddressOrFail, invertPathUniswapV3, sendTransaction } from '@src/helpers'
import { PoolBuilder } from '@src/helpers/PoolBuilder'
import { bnbTestnetDcaPools } from '@src/constants'
import { getChainId } from '@src/helpers/chain-id'

const interval = (24 * 60 * 60).toString() // 24 hours

async function getDcaContract() {
    return DollarCostAverage__factory.connect(
        await findAddressOrFail('DollarCostAverage'),
        (await hre.ethers.getSigners())[0],
    )
}

async function createProposal() {
    const chainId = Chain.parseChainIdOrFail((await hre.ethers.provider.getNetwork()).chainId)
    const swaps = await PoolBuilder.buildPools(new BigNumber(3_000), new BigNumber(0.015))
    const transactions: PreparedTransactionRequest[] = []
    const dcaContract = await getDcaContract()
    const exchanges = await API.getExchanges()

    for (const pool of swaps) {
        const routerAddress = exchanges.find(exchange => exchange.chainId === chainId)?.router

        if (!routerAddress) {
            console.error(`No router found for chain ${ chainId }`)

            continue
        }

        transactions.push(
            await dcaContract.createPool.populateTransaction(
                await unwrapAddressLike(pool.path.inputToken),
                await unwrapAddressLike(pool.path.outputToken),
                routerAddress,
                await pool.path.encodedPath(),
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
