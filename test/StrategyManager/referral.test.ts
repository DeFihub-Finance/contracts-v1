import { expect } from 'chai'
import { Fees } from '@defihub/shared'
import { AbiCoder, AddressLike, ContractTransactionReceipt, parseEther, Signer, ZeroAddress } from 'ethers'
import { createStrategy, getEventLog, getFeeEventLog } from '@src/helpers'
import { StrategyManager__v2, SubscriptionManager, TestERC20, UseFee } from '@src/typechain'
import { baseStrategyManagerFixture } from './fixtures/base.fixture'
import { FeeTo } from '@src/constants'

/*
-> when investV2 method is called
    -> if sender does not have a referrer
        -> emits Referral event
        -> send fees to referrer
        -> emits Fee event with referrer
    -> if sender already has a referrer
        -> not emits Referral event
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
    -> not emits Referral event
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
    let account0: Signer
    let account1: Signer
    let account2: Signer
    let treasury: Signer

    // tokens
    let stablecoin: TestERC20

    // hub contracts
    let dca: UseFee
    let buyProduct: UseFee
    let vaultManager: UseFee
    let liquidityManager: UseFee
    let strategyManager: StrategyManager__v2

    // global data
    let strategyId: bigint
    let permitAccount0: SubscriptionManager.PermitStruct
    let treasuryBalanceBefore: bigint
    let strategistRewardsBefore: bigint
    let referrerRewardsBefore: bigint
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
        return strategyManager.connect(account0).invest({
            strategyId,
            inputToken: stablecoin,
            inputAmount: amountToInvest,
            inputTokenSwap: '0x',
            dcaSwaps: ['0x'],
            vaultSwaps: [],
            liquidityZaps: [],
            buySwaps: [],
            investorPermit: permitAccount0,
            strategistPermit: permitAccount0,
        })
    }

    function investV2(referrer: AddressLike) {
        return strategyManager.connect(account0).investV2({
            strategyId,
            inputToken: stablecoin,
            inputAmount: amountToInvest,
            inputTokenSwap: '0x',
            dcaSwaps: ['0x'],
            vaultSwaps: [],
            liquidityZaps: [],
            buySwaps: [],
            investorPermit: permitAccount0,
            strategistPermit: permitAccount0,
        }, referrer)
    }

    beforeEach(async () => {
        ({
            // accounts
            account0,
            account1,
            account2,
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
            permitAccount0,
        } = await baseStrategyManagerFixture())

        await stablecoin.mint(account0, mintAmount),
        await stablecoin.connect(account0).approve(strategyManager, mintAmount),

        // Create simple DCA strategy
        strategyId = await createStrategy(
            account0,
            permitAccount0,
            strategyManager,
            {
                dcaInvestments: [{ poolId: 0, swaps: 10, percentage: 100 }],
                vaultInvestments: [],
                liquidityInvestments: [],
                buyInvestments: [],
            },
        )

        treasuryBalanceBefore = await stablecoin.balanceOf(treasury)
        strategistRewardsBefore = await strategyManager.getStrategistRewards(account0)
    })

    describe('when investV2 method is called', () => {
        beforeEach(async () => {
            referrerRewardsBefore = await strategyManager.getReferrerRewards(account1)

            receipt = await (await investV2(account1)).wait()
        })

        describe('if sender does not have a referrer', () => {
            it('emits Referral event', async () => {
                const referralEvent = getEventLog(receipt, 'Referral', strategyManager.interface)

                expect(referralEvent?.args).to.deep.equal([
                    await account1.getAddress(),
                    await account0.getAddress(),
                ])
            })

            it('send fees to referrer', async () => {
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)
                const referrerRewardsDelta = await strategyManager.getReferrerRewards(account1) - referrerRewardsBefore

                expect(referrerRewardsDelta).to.be.greaterThan(0n)
                expect(referrerRewardsDelta).to.be.equal(referrerFee)
            })

            it('emits Fee event with referrer', async () => {
                const referrerFeeEvent = getFeeEventLog(receipt, FeeTo.REFERRER)
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)

                expect(referrerFeeEvent?.args).to.deep.equal([
                    await account0.getAddress(),
                    await account1.getAddress(),
                    referrerFee,
                    AbiCoder.defaultAbiCoder().encode(['uint', 'uint8'], [strategyId, FeeTo.REFERRER]),
                ])
            })
        })

        describe('if sender already has a referrer', () => {
            beforeEach(async () => {
                referrerRewardsBefore = await strategyManager.getReferrerRewards(account1)

                // Second investment using another referrer
                receipt = await (await investV2(account2)).wait()
            })

            it('not emits Referral event', async () => {
                const referralEvent = getEventLog(receipt, 'Referral', strategyManager.interface)

                expect(referralEvent).to.be.undefined
            })

            it('send fees to first referrer used', async () => {
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)
                const referrerRewardsDelta = await strategyManager.getReferrerRewards(account1) - referrerRewardsBefore

                expect(referrerRewardsDelta).to.be.greaterThan(0n)
                expect(referrerRewardsDelta).to.be.equal(referrerFee)
                expect(await strategyManager.getReferrerRewards(account2)).to.be.equal(0n)
            })

            it('emits Fee event with first referrer used', async () => {
                const referrerFeeEvent = getFeeEventLog(receipt, FeeTo.REFERRER)
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)

                expect(referrerFeeEvent?.args).to.deep.equal([
                    await account0.getAddress(),
                    await account1.getAddress(),
                    referrerFee,
                    AbiCoder.defaultAbiCoder().encode(['uint', 'uint8'], [strategyId, FeeTo.REFERRER]),
                ])
            })
        })
    })

    describe('when invest method is called', () => {
        describe('if sender does not have a referrer', () => {
            beforeEach(async () => {
                referrerRewardsBefore = await strategyManager.getReferrerRewards(account1)

                receipt = await (await invest()).wait()
            })

            it('send fees to treasury and strategist', async () => {
                const {
                    protocolFee,
                    referrerFee,
                    strategistFee,
                } = await getStrategyFeeAmount(amountToInvest, false)

                const treasuryBalanceDelta = await stablecoin.balanceOf(treasury) - treasuryBalanceBefore
                const referrerRewardsDelta = await strategyManager.getReferrerRewards(account1) - referrerRewardsBefore
                const strategistRewardsDelta = await strategyManager.getStrategistRewards(account0) - strategistRewardsBefore

                expect(treasuryBalanceDelta).to.be.equal(protocolFee)
                expect(strategistRewardsDelta).to.be.equal(strategistFee)

                expect(referrerRewardsDelta).to.be.equal(0n)
                expect(referrerRewardsDelta).to.be.equal(referrerFee)
            })

            it('not emits Fee event with referrer', async () => {
                const referrerFeeEvent = getFeeEventLog(receipt, FeeTo.REFERRER)

                expect(referrerFeeEvent).to.be.undefined
            })
        })

        describe('if sender already has a referrer', () => {
            beforeEach(async () => {
                // Call investV2 first to set a referrer
                await investV2(account1)

                referrerRewardsBefore = await strategyManager.getReferrerRewards(account1)

                receipt = await (await invest()).wait()
            })

            it('send fees to referrer', async () => {
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)
                const referrerRewardsDelta = await strategyManager.getReferrerRewards(account1) - referrerRewardsBefore

                expect(referrerRewardsDelta).to.be.greaterThan(0n)
                expect(referrerRewardsDelta).to.be.equal(referrerFee)
            })

            it('emits Fee event with referrer', async () => {
                const referrerFeeEvent = getFeeEventLog(receipt, FeeTo.REFERRER)
                const { referrerFee } = await getStrategyFeeAmount(amountToInvest)

                expect(referrerFeeEvent?.args).to.deep.equal([
                    await account0.getAddress(),
                    await account1.getAddress(),
                    referrerFee,
                    AbiCoder.defaultAbiCoder().encode(['uint', 'uint8'], [strategyId, FeeTo.REFERRER]),
                ])
            })
        })
    })

    describe('when investV2 method is called using an invalid referrer', () => {
        beforeEach(async () => {
            referrerRewardsBefore = await strategyManager.getReferrerRewards(account1)

            receipt = await (await investV2(ZeroAddress)).wait()
        })

        it('not emits Referral event', async () => {
            const referralEvent = getEventLog(receipt, 'Referral', strategyManager.interface)

            expect(referralEvent).to.be.undefined
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

            const treasuryBalanceDelta = await stablecoin.balanceOf(treasury) - treasuryBalanceBefore
            const referrerRewardsDelta = await strategyManager.getReferrerRewards(ZeroAddress) - referrerRewardsBefore
            const strategistRewardsDelta = await strategyManager.getStrategistRewards(account0) - strategistRewardsBefore

            expect(treasuryBalanceDelta).to.be.equal(protocolFee)
            expect(strategistRewardsDelta).to.be.equal(strategistFee)

            expect(referrerRewardsDelta).to.be.equal(0n)
            expect(referrerRewardsDelta).to.be.equal(referrerFee)
        })
    })

    describe('when collectReferrerRewards method is called', () => {
        beforeEach(() => investV2(account1))

        describe('if referrer has rewards to collect', () => {
            it('then the referrer\'s balance increases proportionally to the rewards collected', async () => {
                const balanceBefore = await stablecoin.balanceOf(account1)
                const toCollect = await strategyManager.getReferrerRewards(account1)

                await strategyManager.connect(account1).collectReferrerRewards()

                const balanceDelta = await stablecoin.balanceOf(account1) - balanceBefore

                expect(toCollect).to.be.greaterThan(0n)
                expect(balanceDelta).to.equal(toCollect)
            })

            it('then the referrer\'s rewards is set to zero', async () => {
                await strategyManager.connect(account1).collectReferrerRewards()
                expect(await strategyManager.getReferrerRewards(account1)).to.equal(0n)
            })

            it('then emits a CollectedReferrerRewards event', async () => {
                const toCollect = await strategyManager.getReferrerRewards(account1)

                await expect(strategyManager.connect(account1).collectReferrerRewards())
                    .to.emit(strategyManager, 'CollectedReferrerRewards')
                    .withArgs(account1, toCollect)
            })
        })

        describe('if referrer has no rewards to collect', () => {
            it('then the referrer\'s balance remains unchanged', async () => {
                const balanceBefore = await stablecoin.balanceOf(account0)

                await strategyManager.connect(account0).collectReferrerRewards()
                expect(await stablecoin.balanceOf(account0)).to.equal(balanceBefore)
            })

            it('then emits a CollectedStrategistRewards event', async () => {
                await expect(strategyManager.connect(account0).collectReferrerRewards())
                    .to.emit(strategyManager, 'CollectedReferrerRewards')
                    .withArgs(account0, 0n)
            })
        })
    })
})
