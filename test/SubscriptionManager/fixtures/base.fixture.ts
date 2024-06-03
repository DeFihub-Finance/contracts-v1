import { ethers } from 'hardhat'
import { TestERC20__factory } from '@src/typechain'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { SubscriptionSignature } from '@src/SubscriptionSignature'

export const baseSubscriptionMangerFixture = async () => {
    const [deployer] = await ethers.getSigners()
    const subscriptionToken = await new TestERC20__factory(deployer).deploy()
    const subscriptionTokenAddress = await subscriptionToken.getAddress()

    const {
        treasury,
        account0,
        subscriptionManager,
        subscriptionSigner,
        subscriptionMonthlyPrice,
    } = await new ProjectDeployer(
        subscriptionTokenAddress,
        subscriptionTokenAddress,
    ).deployProjectFixture()

    await subscriptionToken.mint(account0.address, ethers.parseEther('100'))
    await subscriptionToken.connect(account0).approve(
        await subscriptionManager.getAddress(),
        subscriptionMonthlyPrice * 12n,
    )

    return {
        treasury,
        account0,
        subscriptionManager,
        subscriptionSigner,
        deployer,
        subscriptionToken,
        subscriptionMonthlyPrice,
        subscriptionSignature: new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        ),
    }
}
