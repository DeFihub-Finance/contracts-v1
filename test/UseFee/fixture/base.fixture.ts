import { ethers } from 'hardhat'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { TestERC20__factory, TestFee__factory } from '@src/typechain'

export const baseUseFeeFixture = async () => {
    const [deployer] = await ethers.getSigners()
    const token = await new TestERC20__factory(deployer).deploy()
    const tokenAddress = await token.getAddress()

    const {
        subscriptionManager,
        subscriptionSigner,
        ...rest
    } = await new ProjectDeployer(
        tokenAddress,
        tokenAddress,
    ).deployProjectFixture()

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
        subscriptionSignature: new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        ),
        ...rest,
    }
}
