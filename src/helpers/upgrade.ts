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
import { PreparedTransactionRequest } from 'ethers'

export interface UpgradeParams {
    proxyAddress: string
    newImplementationName: string
    calldata?: string
}

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

async function getUpgradeTransaction(
    {
        proxyAddress,
        newImplementationName,
        calldata,
    }: UpgradeParams,
) {
    const deployer = await getSigner()
    const newImplementationAddress = await deployImplementation(newImplementationName)
    const proxyContract = UUPSUpgradeable__factory.connect(proxyAddress, deployer)

    return calldata
        ? proxyContract
            .upgradeToAndCall
            .populateTransaction(newImplementationAddress, calldata)
        : proxyContract
            .upgradeTo
            .populateTransaction(newImplementationAddress)
}

export async function upgrade(upgradeParams: UpgradeParams): Promise<void> {
    await proposeTransactions(
        await getChainId(),
        [await getUpgradeTransaction(upgradeParams)],
    )
}

export async function upgradeMany(upgrades: UpgradeParams[]): Promise<void> {
    const transactions: PreparedTransactionRequest[] = []

    for (const upgradeParams of upgrades)
        transactions.push(await getUpgradeTransaction(upgradeParams))

    await proposeTransactions(
        await getChainId(),
        transactions,
    )
}
