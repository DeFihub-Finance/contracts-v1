import { PathUniswapV3, unwrapAddressLike } from '@defihub/shared'
import { Chain } from '@ryze-blockchain/ethereum'
import { bnbDcaPools } from '@src/constants/dca'
import { proposeTransactions } from '@src/helpers/safe'
import { PreparedTransactionRequest } from 'ethers'
import hre from 'hardhat'
import { DollarCostAverage__factory } from '@src/typechain'
import {
    findAddressOrFail,
    invertPathUniswapV3,
    sendTransaction,
} from '@src/helpers'
import { validateDcaPools } from '@src/helpers/validate-dca-pools'

const interval = (24 * 60 * 60).toString() // 24 hours
const useMultisig = true
const pools = [
    ...bnbDcaPools,
    ...bnbDcaPools.map(invertPathUniswapV3),
]
const minLiquidity = 25_000

async function createProposal(dcaAddress: string, routerAddress: string) {
    const chainId = Chain.parseChainIdOrFail((await hre.ethers.provider.getNetwork()).chainId)
    const [deployer] = await hre.ethers.getSigners()

    await validateDcaPools(pools, minLiquidity)

    const transactions: PreparedTransactionRequest[] = []
    const dcaContract = DollarCostAverage__factory.connect(dcaAddress, deployer)

    for (const pool of pools) {
        transactions.push(
            await dcaContract.createPool.populateTransaction(
                await unwrapAddressLike(pool.inputToken),
                await unwrapAddressLike(pool.outputToken),
                routerAddress,
                await pool.encodedPath(),
                interval,
            ),
        )
    }

    await proposeTransactions(chainId, transactions)
}

async function sendTestnetTransaction(dcaAddress: string, routerAddress: string) {
    const [deployer] = await hre.ethers.getSigners()
    const contract = DollarCostAverage__factory.connect(dcaAddress, deployer)

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
    const dcaAddress = await findAddressOrFail('DollarCostAverage')
    const routerAddress = await findAddressOrFail('UniswapRouterV3')

    useMultisig
        ? await createProposal(dcaAddress, routerAddress)
        : await sendTestnetTransaction(dcaAddress, routerAddress)
}

createPools()
