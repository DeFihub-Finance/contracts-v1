import { expect } from 'chai'
import { parseEther, Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { NetworkService } from '@src/NetworkService'
import { SubscriptionManager, TestFee } from '@src/typechain'
import { baseUseFeeFixture } from './fixture/base.fixture'

const BASE_FEE = 7n // 0.7%
const NON_SUBSCRIBER_FEE = 3n // 0.3%

const getBaseFee = (amount: bigint) => amount * BASE_FEE / 1_000n
const getNonSubscriberFee = (amount: bigint) => amount * (NON_SUBSCRIBER_FEE) / 1_000n

// given a subscribed user
//      when the user calculates the fee with a valid permit
//          then the base fee is calculated correctly
//          then non-subscriber fee is zero
//      when the user calculates the fee with an invalid permit
//          then SubscriptionExpired is emitted
//  given a non-subscribed user
//      when the user calculates the fee
//          then the base fee is calculated correctly
//          then non-subscriber fee is calculated correctly
//          then is should not allow to calculate the fee with another users permit
describe('UseFee#calculateFee', () => {
    let useFee: TestFee
    let account0: Signer
    let account1: Signer
    let subscriptionSignature: SubscriptionSignature
    let subscriptionManager: SubscriptionManager
    const amount = parseEther('10')

    beforeEach(async () => {
        ({
            useFee,
            subscriptionSignature,
            account0,
            account1,
            subscriptionManager,
        } = await loadFixture(baseUseFeeFixture))
    })

    describe('given a subscribed user', () => {
        let permit: SubscriptionManager.PermitStruct

        beforeEach(async () => {
            permit = await subscriptionSignature.signSubscriptionPermit(
                await account0.getAddress(),
                await NetworkService.getBlockTimestamp() + 10_000,
            )
        })

        describe('when the user calculates the fee with a valid permit', () => {
            it('then the base fee is calculated correctly', async () => {
                const { baseFee } = await useFee.calculateFee(
                    account0,
                    amount,
                    permit,
                )

                expect(baseFee).to.equal(getBaseFee(amount))
            })

            it('then non-subscriber fee is zero', async () => {
                const { nonSubscriberFee } = await useFee.calculateFee(
                    account0,
                    amount,
                    permit,
                )

                expect(nonSubscriberFee).to.equal(0n)
            })
        })

        describe('when the user calculates the fee with an invalid permit', () => {
            let permit: SubscriptionManager.PermitStruct

            beforeEach(async () => {
                permit = await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    await NetworkService.getBlockTimestamp() - 10_000,
                )
            })

            it('then SubscriptionExpired is emitted', async () => {
                await expect(useFee.calculateFee(
                    account0,
                    amount,
                    permit,
                )).to.be.revertedWithCustomError(subscriptionManager, 'SubscriptionExpired')
            })
        })
    })

    describe('given a non-subscribed user', () => {
        let permit: SubscriptionManager.PermitStruct

        beforeEach(async () => {
            permit = await subscriptionSignature.signSubscriptionPermit(
                await account0.getAddress(),
                0,
            )
        })

        describe('when the user calculates the fee', () => {
            it('then the base fee is calculated correctly', async () => {
                const { baseFee } = await useFee.calculateFee(
                    account0,
                    amount,
                    permit,
                )

                expect(baseFee).to.equal(getBaseFee(amount))
            })

            it('then non-subscriber fee is calculated correctly', async () => {
                const { nonSubscriberFee } = await useFee.calculateFee(
                    account0,
                    amount,
                    permit,
                )

                expect(nonSubscriberFee).to.equal(getNonSubscriberFee(amount))
            })

            it('then is should not allow to calculate the fee with another users permit', async () => {
                await expect(useFee.calculateFee(
                    account1,
                    amount,
                    await subscriptionSignature.signSubscriptionPermit(
                        await account0.getAddress(),
                        await NetworkService.getBlockTimestamp() + 10_000,
                    ),
                )).to.be.revertedWithCustomError(subscriptionManager, 'InvalidSignature')
            })

        })
    })
})
