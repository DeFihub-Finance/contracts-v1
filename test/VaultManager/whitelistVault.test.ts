import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { Signer, ZeroAddress } from 'ethers'
import { NetworkService } from '@src/NetworkService'
import { VaultManager, TestVault } from '@src/typechain'
import { baseVaultManagerFixture } from './fixtures/base.fixture'

// given the owner of VaultManager
//      when setVaultWhitelistStatus is called with true
//          then the vault is whitelisted
//          then VaultWhitelisted event is emitted with the vault address and true
//          then return the vault from getWhiteListedVaults
//      when setVaultWhitelistStatus is called with false
//          then the vault is blacklisted
//          then VaultWhitelisted event is emitted with the vault address and false
//          then not return the vault from getWhiteListedVaults
// given a non-owner of VaultManager
//      when setVaultWhitelistStatus is called
//          then transaction reverts with Unauthorized
describe('VaultManager#setVaultWhitelistStatus', () => {
    let vaultManager: VaultManager
    let vault: TestVault
    let account0: Signer
    let owner: Signer

    beforeEach(async () => {
        ({
            vaultManager,
            vault,
            account0,
        } = await loadFixture(baseVaultManagerFixture))

        owner = await NetworkService.impersonate(await vaultManager.owner())
    })

    describe('given the owner of VaultManager', () => {
        describe('when setVaultWhitelistStatus is called with true', () => {
            it('then the vault is whitelisted', async () => {
                await vaultManager.connect(owner).setVaultWhitelistStatus(vault, true)

                expect(await vaultManager.whitelistedVaults(vault)).to.equal(true)
            })

            it('then VaultWhitelisted event is emitted with the vault address and true', async () => {
                await expect(vaultManager.connect(owner).setVaultWhitelistStatus(vault, true))
                    .to.emit(vaultManager, 'VaultWhitelisted')
                    .withArgs(await vault.getAddress(), true)
            })

            it('then return the vault from getWhiteListedVaults', async () => {
                expect(await vaultManager.getWhitelistedVaults()).to.deep.equal([await vault.getAddress()])
            })
        })

        describe('when setVaultWhitelistStatus is called with false', () => {
            it('then the vault is blacklisted', async () => {
                await vaultManager.connect(owner).setVaultWhitelistStatus(vault, false)

                expect(await vaultManager.whitelistedVaults(vault)).to.equal(false)
            })

            it('then VaultWhitelisted event is emitted with the vault address and false', async () => {
                await expect(vaultManager.connect(owner).setVaultWhitelistStatus(vault, false))
                    .to.emit(vaultManager, 'VaultWhitelisted')
                    .withArgs(await vault.getAddress(), false)
            })

            it('then not return the vault from getWhiteListedVaults', async () => {
                await expect(vaultManager.connect(owner).setVaultWhitelistStatus(vault, false))
                    .to.emit(vaultManager, 'VaultWhitelisted')
                    .withArgs(await vault.getAddress(), false)

                expect(await vaultManager.getWhitelistedVaults()).to.deep.equal([ZeroAddress])
            })
        })
    })

    describe('given a non-owner of VaultManager', () => {
        describe('when setVaultWhitelistStatus is called', () => {
            it('then transaction reverts with Unauthorized', async () => {

                await expect(vaultManager.connect(account0).setVaultWhitelistStatus(vault, true))
                    .to.be.revertedWith('Ownable: caller is not the owner')
            })
        })
    })
})
