import { Signer } from 'ethers'
import hre from 'hardhat'
import { CommandBuilder, Salt, Storage, StorageType, VanityDeployer } from 'hardhat-vanity'
import { GenericDeployer__factory, ProjectDeployer, ProjectDeployer__factory } from '@src/typechain'
import { sendDeploymentTransaction, sendTransaction } from './transaction'
import { verify } from '@src/helpers/verify'

export const vanityDeployer = new VanityDeployer({
    startsWith: process.env.STARTS_WITH,
    endsWith: process.env.ENDS_WITH,
})

export async function getSaltBuilder(projectDeployer: ProjectDeployer) {
    return new Salt(
        vanityDeployer.matcher,
        new CommandBuilder({ skip: process.env.SKIP_GPU }),
        await projectDeployer.getAddress(),
    )
}

export async function getSigner() {
    return (await hre.ethers.getSigners())[0]
}

export async function getProjectDeployer(deployer: Signer) {
    const projectDeployerAddress = await Storage.findAddress('ProjectDeployer')
        || await sendDeploymentTransaction(ProjectDeployer__factory.bytecode, deployer)

    const projectDeployer = ProjectDeployer__factory.connect(projectDeployerAddress, deployer)

    await saveAddress('ProjectDeployer', await projectDeployer.getAddress())

    return projectDeployer
}

export async function getGenericDeployer(deployer: Signer) {
    const projectDeployerAddress = await Storage.findAddress('GenericDeployer')
        || await sendDeploymentTransaction(GenericDeployer__factory.bytecode, deployer)

    const genericDeployer = GenericDeployer__factory.connect(projectDeployerAddress, deployer)

    await saveAddress('GenericDeployer', await genericDeployer.getAddress())

    return genericDeployer
}

export function getImplementationSalt(saltBuilder: Salt, contract: string) {
    return saltBuilder.getImplementationSalt(
        contract,
        { saveAs: contract + 'Implementation' },
    )
}

export async function getProxyHash(
    saltBuilder: Salt,
    contract: string,
    implementationSalt: string,
    saveAs?: string,
) {
    const implementation = saltBuilder.computeAddress(
        (await hre.ethers.getContractFactory(contract)).bytecode,
        implementationSalt,
    )

    return saltBuilder.getProxySalt(contract, implementation, { saveAs })
}

export async function getImplementationAndProxySalt(saltBuilder: Salt, contract: string) {
    const implementationSalt = await getImplementationSalt(saltBuilder, contract)

    return {
        implementationSalt,
        proxySalt: await getProxyHash(saltBuilder, contract, implementationSalt),
    }
}

export async function getDeploymentInfo(saltBuilder: Salt, contract: string) {
    const salts = await getImplementationAndProxySalt(saltBuilder, contract)

    return {
        code: (await hre.ethers.getContractFactory(contract)).bytecode,
        ...salts,
    }
}

export async function saveAddress(name: string, address: string) {
    return await Storage.save({
        type: StorageType.ADDRESS,
        name,
        value: address,
    })
}

export async function findAddressOrFail(name: string) {
    const address = await Storage.findAddress(name)

    if (address)
        return address

    throw new Error(`No address for ${ name }`)
}

export async function deployImplementation(
    contractName: string,
    bytecode: string,
) {
    const deployer = await getSigner()
    const projectDeployer = await getProjectDeployer(deployer)
    const saltBuilder = new Salt(
        vanityDeployer.matcher,
        new CommandBuilder(),
        await projectDeployer.getAddress(),
    )
    const salt = await getImplementationSalt(saltBuilder, contractName)
    const expectedImplementationAddress = await projectDeployer.getDeployAddress(bytecode, salt)

    await sendTransaction(await projectDeployer.deploy.populateTransaction(bytecode, salt), deployer)
    await verify(expectedImplementationAddress, [])

    return expectedImplementationAddress
}
