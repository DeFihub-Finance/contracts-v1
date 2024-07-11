import { parseEther } from 'ethers'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { deployVaultFixture } from './deploy-vault.fixture'

export const baseVaultManagerFixture = async () => {
    const {
        account0,
        vaultManager,
        stablecoin,
        ...rest
    } = await new ProjectDeployer().deployProjectFixture()

    const vault = await deployVaultFixture(await stablecoin.getAddress())

    await vaultManager.setVaultWhitelistStatus(vault, true)

    await Promise.all([
        stablecoin.mint(account0, parseEther('10000')),
        stablecoin.connect(account0).approve(vaultManager, parseEther('10000')),
    ])

    return {
        account0,
        vault,
        vaultManager,
        stablecoin,
        ...rest,
    }
}
