import { parseEther } from 'ethers'
import { ethers } from 'hardhat'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { TestERC20__factory } from '@src/typechain'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { deployVaultFixture } from './deploy-vault.fixture'

export const baseVaultManagerFixture = async () => {
    const [deployer] = await ethers.getSigners()
    const token = await new TestERC20__factory(deployer).deploy()
    const tokenAddress = await token.getAddress()
    const vault =  await deployVaultFixture(tokenAddress)

    const {
        account0,
        vaultManager,
        subscriptionManager,
        subscriptionSigner,
        ...rest
    } = await new ProjectDeployer(
        tokenAddress,
        tokenAddress,
    ).deployProjectFixture()

    await vaultManager.setVaultWhitelistStatus(await vault.getAddress(), true)

    await Promise.all([
        token.mint(await account0.getAddress(), parseEther('10000')),
        token.connect(account0).approve(
            await vaultManager.getAddress(),
            parseEther('10000'),
        ),
    ])

    return {
        account0,
        vault,
        vaultManager,
        token,
        tokenAddress,
        subscriptionSignature: new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        ),
        ...rest,
    }
}
