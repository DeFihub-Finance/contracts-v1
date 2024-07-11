import { ethers } from 'hardhat'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { TestFee__factory } from '@src/typechain'

export const baseUseFeeFixture = async () => {
    const [deployer] = await ethers.getSigners()

    const {
        subscriptionManager,
        subscriptionSigner,
        ...rest
    } = await new ProjectDeployer().deployProjectFixture()

    const useFee = await new TestFee__factory(deployer).deploy()

    await useFee.initialize(
        deployer,
        subscriptionManager,
        70n,
        30n,
    )

    return {
        useFee,
        subscriptionManager,
        subscriptionSigner,
        ...rest,
    }
}
