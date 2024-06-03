import { expect } from 'chai'
import { Signer, keccak256 } from 'ethers'
import { StrategyManager } from '@src/typechain'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { NetworkService } from '@src/NetworkService'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { baseStrategyManagerFixture } from './fixtures/base.fixture'

// EFFECTS
// => creates new strategy
// => emit StrategyCreated
//
// SIDE-EFFECTS
// => increases strategy count
//
// REVERTS
// => if msg.sender doens't have an active subscription
// => if strategy uses more than 20 investments
// => if vault used by strategy doesn't belong to DefiHub
describe('StrategyManager#createStrategy', () => {
    let account0: Signer
    let account1: Signer
    let strategyManager: StrategyManager
    let dcaStrategyPositions: StrategyManager.DcaStrategyStruct[]
    let vaultStrategyPosition: StrategyManager.VaultStrategyStruct[]
    let subscriptionSignature: SubscriptionSignature
    let deadline: number
    const nameBioHash = keccak256(new TextEncoder().encode('Name' + 'Bio'))

    beforeEach(async () => {
        ({
            account0,
            account1,
            strategyManager,
            dcaStrategyPositions,
            vaultStrategyPosition,
            subscriptionSignature,
        } = await loadFixture(baseStrategyManagerFixture))

        deadline = await NetworkService.getBlockTimestamp() + 10_000
    })

    describe('EFFECTS', async () => {
        it('creates new strategy', async () => {
            await strategyManager.connect(account0).createStrategy(
                dcaStrategyPositions,
                vaultStrategyPosition,
                await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            const strategy = await strategyManager.getStrategy(0)

            expect(strategy.dcaInvestments[0].swaps).to.be.equal(dcaStrategyPositions[0].swaps)
            expect(strategy.dcaInvestments[0].poolId).to.be.equal(dcaStrategyPositions[0].poolId)
            expect(strategy.dcaInvestments[0].percentage).to.be.equal(dcaStrategyPositions[0].percentage)

            expect(strategy.dcaInvestments[1].swaps).to.be.equal(dcaStrategyPositions[1].swaps)
            expect(strategy.dcaInvestments[1].poolId).to.be.equal(dcaStrategyPositions[1].poolId)
            expect(strategy.dcaInvestments[1].percentage).to.be.equal(dcaStrategyPositions[1].percentage)

            expect(strategy.vaultInvestments[0].vault).to.be.equal(vaultStrategyPosition[0].vault)
            expect(strategy.vaultInvestments[0].percentage).to.be.equal(vaultStrategyPosition[0].percentage)
        })

        it('emit StrategyCreated', async () => {
            const tx = strategyManager.connect(account0).createStrategy(
                dcaStrategyPositions,
                vaultStrategyPosition,
                await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            await expect(tx)
                .to.emit(strategyManager, 'StrategyCreated')
                .withArgs(
                    await account0.getAddress(),
                    0,
                    nameBioHash,
                )
        })
    })

    describe('SIDE-EFFECTS', () => {
        it('increases strategy count', async () => {
            expect(await strategyManager.getStrategiesLength()).to.be.equal(0)

            await strategyManager.connect(account0).createStrategy(
                dcaStrategyPositions,
                vaultStrategyPosition,
                await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            expect(await strategyManager.getStrategiesLength()).to.be.equal(1)
        })
    })

    describe('REVERTS', () => {
        it('if msg.sender doenst have an active subscription', async () => {
            const tx = strategyManager.connect(account1).createStrategy(
                dcaStrategyPositions,
                vaultStrategyPosition,
                await subscriptionSignature.signSubscriptionPermit(
                    await account1.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            expect(tx).to.be.revertedWithCustomError(strategyManager, 'Unauthorized')
        })

        it('if strategy uses more than 20 dca investments', async () => {
            const investments: StrategyManager.DcaStrategyStruct[] = new Array(21)
                .map(() => ({
                    // @dev percentage doesn't matter here, the investmentCount check happens before
                    percentage: 0,
                    poolId: 0,
                    swaps: 10,
                }))

            const tx = strategyManager.connect(account0).createStrategy(
                investments,
                [],
                await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            expect(tx).to.be.revertedWithCustomError(strategyManager, 'TooManyInvestments')
        })

        it('if strategy uses more than 20 vault investments', async () => {
            const investments: StrategyManager.VaultStrategyStruct[] = new Array(21)
                .map(() => ({
                    // @dev percentage doesn't matter here, the investmentCount check happens before
                    percentage: 0,
                    vault: '',
                }))

            const tx = strategyManager.connect(account0).createStrategy(
                [],
                investments,
                await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            expect(tx).to.be.revertedWithCustomError(strategyManager, 'TooManyInvestments')
        })

        it('if strategy uses more than 20 investments total', async () => {
            const vaultInvestments: StrategyManager.VaultStrategyStruct[] = new Array(10)
                .map(() => ({
                    // @dev percentage doesn't matter here, the investmentCount check happens before
                    percentage: 0,
                    vault: '',
                }))

            const dcaInvestment: StrategyManager.DcaStrategyStruct[] = new Array(21)
                .map(() => ({
                    // @dev percentage doesn't matter here, the investmentCount check happens before
                    percentage: 0,
                    poolId: 0,
                    swaps: 10,
                }))

            const tx = strategyManager.connect(account0).createStrategy(
                dcaInvestment,
                vaultInvestments,
                await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            expect(tx).to.be.revertedWithCustomError(strategyManager, 'TooManyInvestments')
        })

        it('if total percentage is different than 100', async () => {
            const tx0 = strategyManager.connect(account0).createStrategy(
                [],
                [],
                await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            const tx1 = strategyManager.connect(account0).createStrategy(
                // 122%
                [...dcaStrategyPositions, ...dcaStrategyPositions],
                [],
                await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                nameBioHash,
            )

            expect(tx0).to.be.revertedWithCustomError(strategyManager, 'InvalidTotalPercentage')
            expect(tx1).to.be.revertedWithCustomError(strategyManager, 'InvalidTotalPercentage')
        })
    })
})
