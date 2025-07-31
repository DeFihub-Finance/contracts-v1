import hre from 'hardhat'
import { UUPSUpgradeable__factory } from '@src/typechain'
import {
    getImplementationSalt,
    getProjectDeployer,
    getSaltBuilder,
    getSigner,
} from '@src/helpers/deployment-helpers'
import { sendTransaction } from '@src/helpers/transaction'
import { getChainId } from '@src/helpers/chain-id'
import { verify } from '@src/helpers/verify'
import { proposeTransactions } from '@src/helpers/safe'

async function deployImplementation(newImplementationName: string) {
    const deployer = await getSigner()
    const projectDeployer = await getProjectDeployer(deployer)
    const saltBuilder = await getSaltBuilder(projectDeployer)
    const salt = await getImplementationSalt(saltBuilder, newImplementationName)
    const bytecode = (await hre.ethers.getContractFactory(newImplementationName)).bytecode
    const expectedImplementationAddress = await projectDeployer.getDeployAddress(bytecode, salt)

    await sendTransaction(await projectDeployer.deploy.populateTransaction(bytecode, salt), deployer)
    await verify(expectedImplementationAddress, [])

    return expectedImplementationAddress
}

async function proposeUpgrade(proxyAddress: string, newImplementationAddress: string, calldata?: string) {
    const chainId = await getChainId()
    const deployer = await getSigner()
    const proxyContract = UUPSUpgradeable__factory.connect(proxyAddress, deployer)
    const transactionData = calldata
        ? await proxyContract
            .upgradeToAndCall
            .populateTransaction(newImplementationAddress, calldata)
        : await proxyContract
            .upgradeTo
            .populateTransaction(newImplementationAddress)

    await proposeTransactions(chainId, [transactionData])
}

export async function upgrade(proxyAddress: string, newImplementationName: string, calldata?: string) {
    return proposeUpgrade(
        proxyAddress,
        await deployImplementation(newImplementationName),
        calldata,
    )
}
