import { ethers } from 'hardhat'
import { TestERC20__factory } from '@src/typechain'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { SubscriptionSignature } from '@src/SubscriptionSignature'

export const baseSubscriptionMangerFixture = async () => {
    const [deployer] = await ethers.getSigners()

    const {
        treasury,
        account0,
        subscriptionManager,
        subscriptionSigner,
        subscriptionMonthlyPrice,
        stablecoin,
    } = await new ProjectDeployer().deployProjectFixture()

    await stablecoin.mint(account0.address, ethers.parseEther('100'))
    await stablecoin.connect(account0).approve(subscriptionManager, subscriptionMonthlyPrice * 12n)

    return {
        treasury,
        account0,
        subscriptionManager,
        subscriptionSigner,
        deployer,
        subscriptionToken: stablecoin,
        subscriptionMonthlyPrice,
        subscriptionSignature: new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        ),
    }
}
