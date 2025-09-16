import { expect } from 'chai'
import { Fees, FeeTo, FeeOperations, unwrapAddressLike } from '@defihub/shared'
import { AddressLike, ContractTransactionReceipt, parseEther, Signer, ZeroAddress } from 'ethers'
import { createStrategy, encodeFeeEventBytes, getEventLog, getFeeEventLog } from '@src/helpers'
import { StrategyManager__v4, SubscriptionManager, TestERC20, UseFee } from '@src/typechain'
import { baseStrategyManagerFixture } from './fixtures/base.fixture'
import { YEAR_IN_SECONDS } from '@src/constants'

/*
-> when investV2 method is called
    -> if sender does not have a referrer
        -> emits ReferralLinked event
        -> send fees to referrer
        -> emits Fee event with referrer
    -> if sender already has a referrer
        -> not emits ReferralLinked event
        -> send fees to first referrer used
        -> emits Fee event with first referrer used

-> when invest method is called
    -> if sender does not have a referrer
        -> not emits Fee event with referrer
        -> send fees to treasury and strategist
    -> if sender already has a referrer
        -> send fees to referrer
        -> emits Fee event with referrer

-> when investV2 method is called using an invalid referrer
    -> not emits ReferralLinked event
    -> not emits Fee event with referrer
    -> send fees only to treasury and strategist

-> when collectReferrerRewards method is called
    -> if referrer has rewards to collect
        -> then the referrer's balance increases proportionally to the rewards collected
        -> then the referrer's rewards is set to zero
        -> then emits a CollectedReferrerRewards event
    -> if referrer has no rewards to collect
        -> then the referrer's balance remains unchanged
        -> then emits a CollectedReferrerRewards event
*/
describe('StrategyManager#referral', () => {
    const amountToInvest = parseEther('100')
    const mintAmount = amountToInvest * 2n

    // accounts
    let strategist: Signer
    let investor: Signer
    let referrer0: Signer
    let referrer1: Signer
    let treasury: Signer

    // tokens
    let stablecoin: TestERC20

    // hub contracts
    let dca: UseFee
    let buyProduct: UseFee
    let vaultManager: UseFee
    let liquidityManager: UseFee
    let strategyManager: StrategyManager__v4

    // global data
    let strategyId: bigint
    let strategistPermit: SubscriptionManager.PermitStruct
    let investorPermit: SubscriptionManager.PermitStruct
    let treasuryBalanceBefore: bigint
    let receipt: ContractTransactionReceipt | null

    function getStrategyFeeAmount(
        amount: bigint,
        hasReferrer = true,
    ) {
        return Fees.getStrategyFeeAmount(
            amount,
            strategyManager,
            strategyId,
            true,
            true,
            hasReferrer,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
        )
    }

    function invest() {
        return strategyManager.connect(investor).invest({
            strategyId,
            inputToken: stablecoin,
            inputAmount: amountToInvest,
            inputTokenSwap: '0x',
            dcaSwaps: ['0x'],
            vaultSwaps: [],
            liquidityZaps: [],
            buySwaps: [],
            investorPermit,
            strategistPermit,
        })
    }

    function investV2(referrer: AddressLike) {
        return strategyManager.connect(investor).investV2({
            strategyId,
            inputToken: stablecoin,
            inputAmount: amountToInvest,
            inputTokenSwap: '0x',
            dcaSwaps: ['0x'],
            vaultSwaps: [],
            liquidityZaps: [],
            buySwaps: [],
            investorPermit,
            strategistPermit,
        }, referrer)
    }

    beforeEach(async () => {
        ({
            // accounts
            account0: strategist,
            account1: referrer0,
            account2: referrer1,
            account3: investor,
            treasury,

            // tokens
            stablecoin,

            // hub contracts
            dca,
            buyProduct,
            vaultManager,
            strategyManager,
            liquidityManager,

            // global data
            permitAccount0: strategistPermit,
            permitAccount3: investorPermit,
        } = await baseStrategyManagerFixture())

        await stablecoin.mint(investor, mintAmount),
        await stablecoin.connect(investor).approve(strategyManager, mintAmount),

        // Create simple DCA strategy
        strategyId = await createStrategy(
            strategist,
            strategistPermit,
            strategyManager,
            {
                dcaInvestments: [{ poolId: 0, swaps: 10, percentage: 100 }],
                vaultInvestments: [],
                liquidityInvestments: [],
                buyInvestments: [],
            },
        )

        treasuryBalanceBefore = await stablecoin.balanceOf(treasury)
    })

    describe('when investV2 method is called', () => {
        beforeEach(async () => receipt = await (await investV2(referrer0)).wait())

        describe('if sender does not have a referrer', () => {
            it('emits ReferralLinked event', async () => {
                const referralEvent = getEventLog(receipt, 'ReferralLinked', strategyManager.interface)

                const block = await receipt?.getBlock()
                const timestamp = block?.timestamp || 0

                expect(referralEvent?.args).to.deep.equal([
                    await referrer0.getAddress(),
                    await investor.getAddress(),
                    timestamp + YEAR_IN_SECONDS * 3,
                ])
            })

            it('send fees to referrer', async () => {
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)
                const referrerRewards = await strategyManager.getReferrerRewards(referrer0)

                expect(referrerRewards).to.be.greaterThan(0n)
                expect(referrerRewards).to.be.equal(referrerFee)
            })

            it('emits Fee event with referrer', async () => {
                const referrerFeeEvent = getFeeEventLog(receipt, FeeTo.REFERRER)
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)

                expect(referrerFeeEvent?.args).to.deep.equal([
                    await investor.getAddress(),
                    await referrer0.getAddress(),
                    referrerFee,
                    encodeFeeEventBytes(strategyId, await unwrapAddressLike(stablecoin), FeeTo.REFERRER, FeeOperations.STRATEGY_DEPOSIT),
                ])
            })
        })

        describe('if sender already has a referrer', () => {
            // referrer already has rewards because this is the second time investing
            let referrerRewardsDelta: bigint

            beforeEach(async () => {
                const referrerRewardsBefore = await strategyManager.getReferrerRewards(referrer0)

                // Second investment using another referrer
                receipt = await (await investV2(referrer1)).wait()

                referrerRewardsDelta = await strategyManager.getReferrerRewards(referrer0) - referrerRewardsBefore
            })

            it('not emits Referral/ReferralLinked event', async () => {
                const referralEvent = getEventLog(receipt, 'Referral', strategyManager.interface)
                const referralLinkedEvent = getEventLog(receipt, 'ReferralLinked', strategyManager.interface)

                expect(referralEvent).to.be.undefined
                expect(referralLinkedEvent).to.be.undefined
            })

            it('send fees to first referrer used', async () => {
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)

                expect(referrerRewardsDelta).to.be.greaterThan(0n)
                expect(referrerRewardsDelta).to.be.equal(referrerFee)
                expect(await strategyManager.getReferrerRewards(referrer1)).to.be.equal(0n)
            })

            it('emits Fee event with first referrer used', async () => {
                const referrerFeeEvent = getFeeEventLog(receipt, FeeTo.REFERRER)
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)

                expect(referrerFeeEvent?.args).to.deep.equal([
                    await investor.getAddress(),
                    await referrer0.getAddress(),
                    referrerFee,
                    encodeFeeEventBytes(strategyId, await unwrapAddressLike(stablecoin), FeeTo.REFERRER, FeeOperations.STRATEGY_DEPOSIT),
                ])
            })
        })
    })

    describe('when invest method is called', () => {
        describe('if sender does not have a referrer', () => {
            beforeEach(async () => receipt = await (await invest()).wait())

            it('send fees to treasury and strategist', async () => {
                const {
                    protocolFee,
                    referrerFee,
                    strategistFee,
                } = await getStrategyFeeAmount(amountToInvest, false)

                const referrerRewards = await strategyManager.getReferrerRewards(referrer0)
                const strategistRewards = await strategyManager.getStrategistRewards(strategist)
                const treasuryBalanceDelta = await stablecoin.balanceOf(treasury) - treasuryBalanceBefore

                expect(treasuryBalanceDelta).to.be.equal(protocolFee)
                expect(strategistRewards).to.be.equal(strategistFee)

                expect(referrerRewards).to.be.equal(0n)
                expect(referrerRewards).to.be.equal(referrerFee)
            })

            it('not emits Fee event with referrer', async () => {
                const referrerFeeEvent = getFeeEventLog(receipt, FeeTo.REFERRER)

                expect(referrerFeeEvent).to.be.undefined
            })
        })

        describe('if sender already has a referrer', () => {
            let referrerRewardsDelta: bigint

            beforeEach(async () => {
                // Call investV2 first to set a referrer
                await investV2(referrer0)

                const referrerRewardsBefore = await strategyManager.getReferrerRewards(referrer0)

                receipt = await (await invest()).wait()

                referrerRewardsDelta = await strategyManager.getReferrerRewards(referrer0) - referrerRewardsBefore
            })

            it('send fees to referrer', async () => {
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)

                expect(referrerRewardsDelta).to.be.greaterThan(0n)
                expect(referrerRewardsDelta).to.be.equal(referrerFee)
            })

            it('emits Fee event with referrer', async () => {
                const referrerFeeEvent = getFeeEventLog(receipt, FeeTo.REFERRER)
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)

                expect(referrerFeeEvent?.args).to.deep.equal([
                    await investor.getAddress(),
                    await referrer0.getAddress(),
                    referrerFee,
                    encodeFeeEventBytes(strategyId, await unwrapAddressLike(stablecoin), FeeTo.REFERRER, FeeOperations.STRATEGY_DEPOSIT),
                ])
            })
        })
    })

    describe('when investV2 method is called using an invalid referrer', () => {
        beforeEach(async () => receipt = await (await investV2(ZeroAddress)).wait())

        it('not emits Referral/ReferralLinked event', async () => {
            const referralEvent = getEventLog(receipt, 'Referral', strategyManager.interface)
            const referralLinkedEvent = getEventLog(receipt, 'ReferralLinked', strategyManager.interface)

            expect(referralEvent).to.be.undefined
            expect(referralLinkedEvent).to.be.undefined
        })

        it('not emits Fee event with referrer', async () => {
            const referralEvent = getFeeEventLog(receipt, FeeTo.REFERRER)

            expect(referralEvent).to.be.undefined
        })

        it('send fees only to treasury and strategist', async () => {
            const {
                protocolFee,
                referrerFee,
                strategistFee,
            } = await getStrategyFeeAmount(amountToInvest, false)

            const referrerRewards = await strategyManager.getReferrerRewards(ZeroAddress)
            const strategistRewards = await strategyManager.getStrategistRewards(strategist)
            const treasuryBalanceDelta = await stablecoin.balanceOf(treasury) - treasuryBalanceBefore

            expect(treasuryBalanceDelta).to.be.equal(protocolFee)
            expect(strategistRewards).to.be.equal(strategistFee)

            expect(referrerRewards).to.be.equal(0n)
            expect(referrerRewards).to.be.equal(referrerFee)
        })
    })

    describe('when collectRewards method is called', () => {
        beforeEach(() => investV2(referrer0))

        describe('if referrer has rewards to collect', () => {
            it('then the referrer\'s balance increases proportionally to the rewards collected', async () => {
                const balanceBefore = await stablecoin.balanceOf(referrer0)
                const toCollect = await strategyManager.getReferrerRewards(referrer0)

                await strategyManager.connect(referrer0).collectRewards(stablecoin)

                const balanceDelta = await stablecoin.balanceOf(referrer0) - balanceBefore

                expect(toCollect).to.be.greaterThan(0n)
                expect(balanceDelta).to.equal(toCollect)
            })

            it('then the referrer\'s rewards is set to zero', async () => {
                await strategyManager.connect(referrer0).collectRewards(stablecoin)
                expect(await strategyManager.getReferrerRewards(referrer0)).to.equal(0n)
            })

            it('then emits a CollectedReferrerRewards event', async () => {
                const toCollect = await strategyManager.getReferrerRewards(referrer0)

                await expect(strategyManager.connect(referrer0).collectRewards(stablecoin))
                    .to.emit(strategyManager, 'CollectedRewards')
                    .withArgs(referrer0, stablecoin, toCollect)
            })
        })

        describe('if referrer has no rewards to collect', () => {
            it('then the referrer\'s balance remains unchanged', async () => {
                const balanceBefore = await stablecoin.balanceOf(investor)

                await strategyManager.connect(investor).collectRewards(stablecoin)
                expect(await stablecoin.balanceOf(investor)).to.equal(balanceBefore)
            })

            it('then will not emit a CollectedRewards event', async () => {
                const transaction = strategyManager.connect(investor).collectRewards(stablecoin)

                await expect(transaction).to.not.emit(strategyManager, 'CollectedRewards')
            })
        })
    })
})
