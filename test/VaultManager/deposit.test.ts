import { expect } from 'chai'
import { Signer, parseEther } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { NetworkService } from '@src/NetworkService'
import { ContractFees } from '@src/ContractFees'
import { TestERC20, TestVault, VaultManager } from '@src/typechain'
import { baseVaultManagerFixture } from './fixtures/base.fixture'

// given a subscribed user
//      when a deposit is made
//          then vault tokens are transferred to the user discounting the base fee
//          then base fee is transferred to the treasury
//          then want tokens are deducted from the user
//          then emits a Deposit event
//          then emits a Fee event
//      and a vault is not whitelisted
//          then reverts with VaultNotWhitelisted
// given a non-subscribed user
//    when a deposit is made
//        then vault tokens are transferred to the user discounting the base fee + non-subscriber fee
//        then base + non-subscriber fees are transferred to the treasury
describe('VaultManager#deposit', () => {
    let account0: Signer
    let treasury: Signer
    let vaultManager: VaultManager
    let vault: TestVault
    let subscriptionSignature: SubscriptionSignature
    let deadline: number
    let stablecoin: TestERC20

    const amountToDeposit = parseEther('10')

    beforeEach(async () => {
        ({
            account0,
            treasury,
            vaultManager,
            vault,
            subscriptionSignature,
            stablecoin,
        } = await loadFixture(baseVaultManagerFixture))

        deadline = await NetworkService.getBlockTimestamp() + 10_000
    })

    describe('given a subscribed user', () => {
        describe('when a deposit is made', () => {
            it('then vault tokens are transferred to the user discounting the base fee', async () => {
                const balanceBefore = await vault.balanceOf(await account0.getAddress())

                await vaultManager.connect(account0).invest(
                    await vault.getAddress(),
                    amountToDeposit,
                    await subscriptionSignature.signSubscriptionPermit(await account0.getAddress(), deadline),
                )

                const balanceDelta = (await vault.balanceOf(await account0.getAddress())) - balanceBefore
                const expectedBalanceDelta = ContractFees.discountBaseFee(amountToDeposit)

                expect(balanceDelta).to.equal(expectedBalanceDelta)
            })

            it('then base fee is transferred to the treasury', async () => {
                const balanceBefore = await stablecoin.balanceOf(await treasury.getAddress())

                await vaultManager.connect(account0).invest(
                    await vault.getAddress(),
                    amountToDeposit,
                    await subscriptionSignature.signSubscriptionPermit(await account0.getAddress(), deadline),
                )

                const balanceDelta = (await stablecoin.balanceOf(await treasury.getAddress())) - balanceBefore
                const expectedBalanceDelta = ContractFees.getBaseFee(amountToDeposit)

                expect(balanceDelta).to.equal(expectedBalanceDelta)
            })

            it('then want tokens are deducted from the user', async () => {
                const balanceBefore = await stablecoin.balanceOf(await account0.getAddress())

                await vaultManager.connect(account0).invest(
                    await vault.getAddress(),
                    amountToDeposit,
                    await subscriptionSignature.signSubscriptionPermit(await account0.getAddress(), deadline),
                )

                const balanceDelta = balanceBefore - (await stablecoin.balanceOf(await account0.getAddress()))

                expect(balanceDelta).to.equal(amountToDeposit)
            })

            it('then emits a Deposit event', async () => {
                const vaultAddress = await vault.getAddress()
                const tx = vaultManager.connect(account0).invest(
                    vaultAddress,
                    amountToDeposit,
                    await subscriptionSignature.signSubscriptionPermit(await account0.getAddress(), deadline),
                )

                // event Deposit(address indexed vault, address indexed user, uint amount);
                expect(tx).to.emit(vault, 'Deposit').withArgs([vaultAddress, await account0.getAddress(), amountToDeposit])
            })

            it('then emits a Fee event', async () => {
                const vaultAddress = await vault.getAddress()

                const tx = vaultManager.connect(account0).invest(
                    vaultAddress,
                    amountToDeposit,
                    await subscriptionSignature.signSubscriptionPermit(await account0.getAddress(), deadline),
                )

                expect(tx)
                    .to.emit(vaultManager, 'Fee')
                    .withArgs([
                        await account0.getAddress(),
                        await treasury.getAddress(),
                        ContractFees.getBaseFee(amountToDeposit),
                    ])
            })
        })

        describe('and a vault is not whitelisted', () => {
            it('then reverts with VaultNotWhitelisted', async () => {
                const vaultAddress = await vault.getAddress()

                await vaultManager.setVaultWhitelistStatus(vaultAddress, false)

                const tx = vaultManager.connect(account0).invest(
                    vaultAddress,
                    amountToDeposit,
                    await subscriptionSignature.signSubscriptionPermit(await account0.getAddress(), deadline),
                )

                await expect(tx).to.revertedWithCustomError(vaultManager, 'VaultNotWhitelisted')
            })
        })
    })

    describe('given a non-subscribed user', () => {
        describe('when a deposit is made', () => {
            it('then vault tokens are transferred to the user discounting the base fee + non-subscriber fee', async () => {
                const balanceBefore = await vault.balanceOf(await account0.getAddress())

                await vaultManager.connect(account0).invest(
                    await vault.getAddress(),
                    amountToDeposit,
                    await subscriptionSignature.signSubscriptionPermit(await account0.getAddress(), 0),
                )

                const balanceDelta = (await vault.balanceOf(await account0.getAddress())) - balanceBefore
                const expectedBalanceDelta = ContractFees.discountNonSubscriberFee(amountToDeposit)

                expect(balanceDelta).to.equal(expectedBalanceDelta)
            })

            it('then base + non-subscriber fees are transferred to the treasury', async () => {
                const balanceBefore = await stablecoin.balanceOf(await treasury.getAddress())

                await vaultManager.connect(account0).invest(
                    await vault.getAddress(),
                    amountToDeposit,
                    await subscriptionSignature.signSubscriptionPermit(await account0.getAddress(), 0),
                )

                const balanceDelta = (await stablecoin.balanceOf(await treasury.getAddress())) - balanceBefore
                const expectedBalanceDelta = ContractFees.getNonSubscriberFee(amountToDeposit)

                expect(balanceDelta).to.equal(expectedBalanceDelta)
            })
        })
    })
})
