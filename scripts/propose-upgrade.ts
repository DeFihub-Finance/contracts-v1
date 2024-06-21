import { Chain } from '@ryze-blockchain/ethereum'
import { proposeTransactions } from '@src/helpers/safe'
import hre from 'hardhat'
import {
    UUPSUpgradeable__factory,
    DollarCostAverage__NoDeadline__factory,
} from '@src/typechain'
import {
    getGenericDeployer,
    getImplementationSalt,
    sendTransaction,
    verify,
    findAddressOrFail,
    vanityDeployer,
} from '@src/helpers'
import { CommandBuilder, Salt } from 'hardhat-vanity'

// You can edit these constants
const BYTECODE = DollarCostAverage__NoDeadline__factory.bytecode
const PROXY_NAME = 'DollarCostAverage'
const NEW_IMPLEMENTATION_NAME = 'DollarCostAverage__NoDeadline'

async function deployImplementation() {
    const [deployer] = await hre.ethers.getSigners()
    const genericDeployer = await getGenericDeployer(deployer)
    const saltBuilder = new Salt(
        vanityDeployer.matcher,
        new CommandBuilder(),
        await genericDeployer.getAddress(),
    )
    const salt = await getImplementationSalt(saltBuilder, NEW_IMPLEMENTATION_NAME)
    const expectedImplementationAddress = await genericDeployer.getDeployAddress(BYTECODE, salt)

    await sendTransaction(await genericDeployer.deploy.populateTransaction(BYTECODE, salt), deployer)
    await verify(expectedImplementationAddress, [])

    return expectedImplementationAddress
}

async function proposeUpgrade() {
    const chainId = Chain.parseChainIdOrFail((await hre.ethers.provider.getNetwork()).chainId)
    const [deployer] = await hre.ethers.getSigners()
    const proxy = await findAddressOrFail(PROXY_NAME)
    const implementation = await deployImplementation()

    await proposeTransactions(chainId, [
        await UUPSUpgradeable__factory
            .connect(proxy, deployer)
            .upgradeTo
            .populateTransaction(implementation),
    ])
}

proposeUpgrade()
