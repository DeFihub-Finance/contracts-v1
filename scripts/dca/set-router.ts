import { sendTransaction } from '@src/helpers'
import { DollarCostAverage__factory } from '@src/typechain'
import hre from 'hardhat'
import { Storage } from 'hardhat-vanity'

const poolId = 0

async function setRouter() {
    const dcaAddress = await Storage.findAddress('DollarCostAverage')
    const [deployer] = await hre.ethers.getSigners()

    if (!dcaAddress)
        throw new Error('create-dca-pool: missing DCA address')

    const routerAddress = await Storage.findAddress('UniswapRouterV3')

    if (!routerAddress)
        throw new Error('create-dca-pool: missing Router address')

    await sendTransaction(
        await DollarCostAverage__factory
            .connect(dcaAddress, deployer)
            .setPoolRouter.populateTransaction(poolId, routerAddress),
        deployer,
    )
}

setRouter()
