import { parseEther } from 'ethers'
import { ethers } from 'hardhat'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { TestERC20__factory } from '@src/typechain'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { deployVaultFixture } from './deploy-vault.fixture'

export const baseVaultManagerFixture = async () => {
    const [deployer] = await ethers.getSigners()
    const token = await new TestERC20__factory(deployer).deploy()
    const vault =  await deployVaultFixture(await token.getAddress())

    const {
        account0,
        vaultManager,
        ...rest
    } = await new ProjectDeployer(token, token).deployProjectFixture()

    await vaultManager.setVaultWhitelistStatus(await vault.getAddress(), true)

    await Promise.all([
        token.mint(account0, parseEther('10000')),
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
        ...rest,
    }
}
