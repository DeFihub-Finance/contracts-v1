import hre from 'hardhat'
import { CommandBuilder, Salt } from 'hardhat-vanity'
import { UUPSUpgradeable__factory } from '@src/typechain'
import {
    getImplementationSalt,
    getProjectDeployer,
    getSigner,
    vanityDeployer,
} from '@src/helpers/deployment-helpers'
import { sendTransaction } from '@src/helpers/transaction'
import { getChainId } from '@src/helpers/chain-id'
import { verify } from '@src/helpers/verify'
import { proposeTransactions } from '@src/helpers/safe'

async function deployImplementation(newImplementationName: string) {
    const deployer = await getSigner()
    const projectDeployer = await getProjectDeployer(deployer)
    const saltBuilder = new Salt(
        vanityDeployer.matcher,
        new CommandBuilder(),
        await projectDeployer.getAddress(),
    )
    const salt = await getImplementationSalt(saltBuilder, newImplementationName)
    const bytecode = (await hre.ethers.getContractFactory(newImplementationName)).bytecode
    const expectedImplementationAddress = await projectDeployer.getDeployAddress(bytecode, salt)

    await sendTransaction(await projectDeployer.deploy.populateTransaction(bytecode, salt), deployer)
    await verify(expectedImplementationAddress, [])

    return expectedImplementationAddress
}

async function proposeUpgrade(proxyAddress: string, newImplementationAddress: string) {
    const chainId = await getChainId()
    const deployer = await getSigner()

    await proposeTransactions(chainId, [
        await UUPSUpgradeable__factory
            .connect(proxyAddress, deployer)
            .upgradeTo
            .populateTransaction(newImplementationAddress),
    ])
}

export async function upgrade(proxyAddress: string, newImplementationName: string) {
    return proposeUpgrade(
        proxyAddress,
        await deployImplementation(newImplementationName),
    )
}
