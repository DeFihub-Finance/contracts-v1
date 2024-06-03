import {
    DollarCostAverage__factory, GenericDeployer,
    ProjectDeployer,
    ProjectDeployer__factory,
} from '@src/typechain'
import { expect } from 'chai'
import { Signer, ZeroAddress } from 'ethers'
import hre from 'hardhat'

describe('project deployer', () => {
    let signer: Signer
    let projectDeployer: ProjectDeployer

    beforeEach(async () => {
        [signer] = await hre.ethers.getSigners()
        projectDeployer = await new ProjectDeployer__factory(signer).deploy()
    })

    describe('deployed address should match getter', () => {
        const salt = '0xb00b5fffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        const dcaBytecode = DollarCostAverage__factory.bytecode

        it('works for implementation', async () => {
            const expectedAddress = await projectDeployer.getDeployAddress(dcaBytecode, salt)
            const transaction = await projectDeployer.deploy(dcaBytecode, salt)
            const receipt = await transaction.wait(1)

            // checks if matches expected address
            expect(receipt?.logs[0].address).to.equal(expectedAddress)

            // checks if deployed contract has the correct bytecode
            expect(
                await DollarCostAverage__factory.connect(expectedAddress, signer).treasury(),
            ).to.equal(ZeroAddress)
        })

        it('works for proxy', async () => {
            const deploymentInfo: GenericDeployer.ProxyDeploymentInfoStruct ={
                code: dcaBytecode,
                proxySalt: salt,
                implementationSalt: salt,
            }
            const expectedAddresses = await projectDeployer.getDeployProxyAddress(deploymentInfo)

            const transaction = await projectDeployer.deployProxy(deploymentInfo)
            const receipt = await transaction.wait(1)

            // checks if matches expected address
            expect(receipt?.logs[0].address).to.equal(expectedAddresses.implementation)
            expect(receipt?.logs[1].address).to.equal(expectedAddresses.proxy)

            // checks if deployed contract has the correct bytecode
            expect(
                await DollarCostAverage__factory.connect(expectedAddresses.implementation, signer).treasury(),
            ).to.equal(ZeroAddress)
            expect(
                await DollarCostAverage__factory.connect(expectedAddresses.proxy, signer).treasury(),
            ).to.equal(ZeroAddress)
        })
    })
})
