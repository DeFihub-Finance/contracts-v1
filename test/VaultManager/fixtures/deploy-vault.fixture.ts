import { ethers } from 'hardhat'
import { TestVault__factory } from '@src/typechain'

export const deployVaultFixture = async (vaultToken: string) => {
    const [deployer] = await ethers.getSigners()

    return new TestVault__factory(deployer).deploy(vaultToken)
}
