import { proposeTransactions } from '@src/helpers/safe'
import { UUPSUpgradeable__factory, DollarCostAverage__NoDeadline__factory } from '@src/typechain'
import { findAddressOrFail, getChainId, getSigner, deployImplementation } from '@src/helpers'

// You can edit these constants
const BYTECODE = DollarCostAverage__NoDeadline__factory.bytecode
const PROXY_NAME = 'DollarCostAverage'
const NEW_IMPLEMENTATION_NAME = 'DollarCostAverage__NoDeadline'

async function proposeUpgrade() {
    const chainId = await getChainId()
    const deployer = await getSigner()
    const proxy = await findAddressOrFail(PROXY_NAME)
    const implementation = await deployImplementation(NEW_IMPLEMENTATION_NAME, BYTECODE)

    await proposeTransactions(chainId, [
        await UUPSUpgradeable__factory
            .connect(proxy, deployer)
            .upgradeTo
            .populateTransaction(implementation),
    ])
}

proposeUpgrade()
