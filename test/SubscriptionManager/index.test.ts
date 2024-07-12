import { expect } from 'chai'
import { Signer, ZeroAddress, parseEther } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { ERC20, SubscriptionManager } from '@src/typechain'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { NetworkService } from '@src/NetworkService'
import { baseSubscriptionMangerFixture } from './fixtures/base.fixture'

describe('SubscriptionManager', () => {
    let account0: Signer
    let treasury: Signer
    let subscriptionToken: ERC20
    let subscriptionManager: SubscriptionManager
    let subscriptionSignature: SubscriptionSignature
    let subscriptionMonthlyPrice: bigint
    const getDeadline = async () => await NetworkService.getBlockTimestamp() + 10_000

    beforeEach(async () => {
        ({
            account0,
            treasury,
            subscriptionSignature,
            subscriptionManager,
            subscriptionToken,
            subscriptionMonthlyPrice,
        } = await loadFixture(baseSubscriptionMangerFixture))
    })

    // EFFECTS
    // => transfer yearly subscription value to treasury
    // => emit Subscribed event
    describe('#subscribe', async () => {
        describe('EFFECTS', () => {
            it('transfer the amount of an yearly subscription to treasury', async () => {
                const balanceBefore = await subscriptionToken.balanceOf(treasury)

                await subscriptionManager.connect(account0).subscribe()

                const balanceAfter = await subscriptionToken.balanceOf(treasury)
                const yearlySubscriptionPrice = subscriptionMonthlyPrice * 12n

                expect(balanceAfter - balanceBefore).to.be.equals(yearlySubscriptionPrice)
            })

            it('emits Subscribed event', async () => {
                const tx = subscriptionManager.connect(account0).subscribe()

                await expect(tx)
                    .to.emit(subscriptionManager, 'Subscribed')
                    .withArgs(await account0.getAddress())
            })
        })
    })

    // EFFECTS
    // => returns the yearly coast of subscription
    describe('#getCost', () => {
        describe('EFFECTS', () => {
            it('returns the yearly subscription cost', async () => {
                expect(await subscriptionManager.getCost())
                    .to.be.equals(subscriptionMonthlyPrice * 12n)
            })
        })
    })

    // EFFECTS
    // => returns false if user is zero address
    // => returns false if deadline is zero
    // => returns true if `recoveredSigner` is `subscriptionSigner`
    //
    // REVERTS
    // => if permit deadline is less than current timestamp
    // => recovered signer is different than `subscriptionSigner`
    describe('#isSubscribed', () => {
        describe('EFFECTS', () => {
            it ('returns false if user is zero address', async () => {
                const signature = await subscriptionSignature.signSubscriptionPermit(
                    ZeroAddress,
                    await getDeadline(),
                )

                const isSubscribed = await subscriptionManager.isSubscribed(
                    ZeroAddress,
                    signature,
                )

                expect(isSubscribed).to.be.false
            })

            it('returns false if deadline is zero', async () => {
                const signature = await subscriptionSignature.signSubscriptionPermit(
                    ZeroAddress,
                    0,
                )

                const isSubscribed = await subscriptionManager.isSubscribed(
                    ZeroAddress,
                    signature,
                )

                expect(isSubscribed).to.be.false
            })

            it('returns true if recoveredSigner is subscriptionSigner', async () => {
                const deadline = await NetworkService.getBlockTimestamp() + 10_000
                const signature = await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                )

                const isSubscribed = await subscriptionManager.isSubscribed(
                    account0,
                    signature,
                )

                expect(isSubscribed).to.be.true
            })
        })

        describe('REVERTS', () => {
            it('reverts if deadline is expired', async () => {
                const expiredDeadline = await NetworkService.getBlockTimestamp() - 100
                const signature = await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    expiredDeadline,
                )

                const isSubscribed = subscriptionManager.isSubscribed(
                    account0,
                    signature,
                )

                await expect(isSubscribed)
                    .to.be.revertedWithCustomError(subscriptionManager, 'SubscriptionExpired')
            })

            it('reverts if signer recovered from signature is different than subscriptionSigner', async () => {
                const signature = await new SubscriptionSignature(subscriptionManager, account0)
                    .signSubscriptionPermit(
                        await account0.getAddress(),
                        await getDeadline(),
                    )

                const isSubscribed = subscriptionManager.isSubscribed(
                    account0,
                    signature,
                )

                await expect(isSubscribed)
                    .to.be.revertedWithCustomError(subscriptionManager, 'InvalidSignature')
            })
        })
    })

    // EFFECTS
    // => set subscription price
    // => emit SubscriptionPriceUpdated event
    describe('#setters', () => {
        describe('EFFECTS', () => {
            it('sets subscription price', async () => {
                const price = parseEther('5')

                await subscriptionManager.setSubscriptionPrice(price)

                const newSubscriptionPrice = await subscriptionManager.pricePerMonth()

                expect(newSubscriptionPrice).to.be.equals(price)
            })

            it('emit SubscriptionPriceUpdated event', async () => {
                const price = parseEther('5')

                const tx = subscriptionManager.setSubscriptionPrice(price)

                await expect(tx)
                    .to.emit(subscriptionManager, 'PricePerMonthUpdated')
                    .withArgs(price)
            })
        })
    })
})
