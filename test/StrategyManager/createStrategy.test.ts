import { expect } from 'chai'
import { Signer, keccak256, ContractTransactionResponse, ZeroAddress } from 'ethers'
import { StrategyManager__v2 } from '@src/typechain'
import { StrategyStorage } from '@src/typechain/artifacts/contracts/StrategyManager'
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
// => if msg.sender doesn't have an active subscription
// => if strategy uses more than 20 investments
// => if vault used by strategy doesn't belong to DeFihub
describe('StrategyManager#createStrategy', () => {
    let account0: Signer
    let account1: Signer
    let strategyManager: StrategyManager__v2
    let dcaStrategyPositions: StrategyStorage.DcaInvestmentStruct[]
    let vaultStrategyPosition: StrategyStorage.VaultInvestmentStruct[]
    let subscriptionSignature: SubscriptionSignature
    let deadline: number
    const metadataHash = keccak256(new TextEncoder().encode('Name' + 'Bio'))

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
        let tx: Promise<ContractTransactionResponse>

        beforeEach(async () => {
            tx = strategyManager.connect(account0).createStrategy({
                dcaInvestments: dcaStrategyPositions,
                vaultInvestments: vaultStrategyPosition,
                liquidityInvestments: [],
                buyInvestments: [],
                permit: await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    await NetworkService.getBlockTimestamp() + 10_000,
                ),
                metadataHash,
            })
        })

        it('creates new strategy', async () => {
            await tx

            const investments = await strategyManager.getStrategyInvestments(0)

            expect(investments.dcaInvestments[0].swaps).to.be.equal(dcaStrategyPositions[0].swaps)
            expect(investments.dcaInvestments[0].poolId).to.be.equal(dcaStrategyPositions[0].poolId)
            expect(investments.dcaInvestments[0].percentage).to.be.equal(dcaStrategyPositions[0].percentage)

            expect(investments.dcaInvestments[1].swaps).to.be.equal(dcaStrategyPositions[1].swaps)
            expect(investments.dcaInvestments[1].poolId).to.be.equal(dcaStrategyPositions[1].poolId)
            expect(investments.dcaInvestments[1].percentage).to.be.equal(dcaStrategyPositions[1].percentage)

            expect(investments.vaultInvestments[0].vault).to.be.equal(vaultStrategyPosition[0].vault)
            expect(investments.vaultInvestments[0].percentage).to.be.equal(vaultStrategyPosition[0].percentage)
        })

        it('emit StrategyCreated', async () => {
            await expect(tx)
                .to.emit(strategyManager, 'StrategyCreated')
                .withArgs(
                    await account0.getAddress(),
                    0,
                    metadataHash,
                )
        })
    })

    describe('SIDE-EFFECTS', () => {
        it('increases strategy count', async () => {
            expect(await strategyManager.getStrategiesLength()).to.be.equal(0)

            await strategyManager.connect(account0).createStrategy({
                dcaInvestments: dcaStrategyPositions,
                vaultInvestments: vaultStrategyPosition,
                liquidityInvestments: [],
                buyInvestments: [],
                permit: await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                metadataHash,
            })

            expect(await strategyManager.getStrategiesLength()).to.be.equal(1)
        })
    })

    describe('REVERTS', () => {
        it('if msg.sender does not have an active subscription', async () => {
            const tx = strategyManager.connect(account1).createStrategy({
                dcaInvestments: dcaStrategyPositions,
                vaultInvestments: vaultStrategyPosition,
                liquidityInvestments: [],
                buyInvestments: [],
                permit: await subscriptionSignature.signSubscriptionPermit(
                    await account1.getAddress(),
                    0,
                ),
                metadataHash,
            })

            await expect(tx).to.be.revertedWithCustomError(strategyManager, 'Unauthorized')
        })

        it('if strategy uses more than 20 dca investments', async () => {
            const investments: StrategyStorage.DcaInvestmentStruct[] = Array.from(
                { length: 21 },
                () => ({
                    // @dev percentage doesn't matter here, the investmentCount check happens before
                    percentage: 0,
                    poolId: 0,
                    swaps: 10,
                }),
            )

            const tx = strategyManager.connect(account0).createStrategy({
                dcaInvestments: investments,
                vaultInvestments: [],
                liquidityInvestments: [],
                buyInvestments: [],
                permit: await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                metadataHash,
            })

            await expect(tx).to.be.revertedWithCustomError(strategyManager, 'LimitExceeded')
        })

        it('if strategy uses more than 20 vault investments', async () => {
            const investments: StrategyStorage.VaultInvestmentStruct[] = Array.from(
                { length: 21 },
                () => ({
                    // @dev percentage doesn't matter here, the investmentCount check happens before
                    percentage: 0,
                    vault: ZeroAddress,
                }),
            )

            const tx = strategyManager.connect(account0).createStrategy({
                dcaInvestments: [],
                vaultInvestments: investments,
                liquidityInvestments: [],
                buyInvestments: [],
                permit: await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                metadataHash,
            })

            await expect(tx).to.be.revertedWithCustomError(strategyManager, 'LimitExceeded')
        })

        it('if strategy uses more than 20 investments total', async () => {
            const vaultInvestments: StrategyStorage.VaultInvestmentStruct[] = Array.from(
                { length: 10 },
                () => ({
                    // @dev percentage doesn't matter here, the investmentCount check happens before
                    percentage: 0,
                    vault: ZeroAddress,
                }),
            )
            const dcaInvestments: StrategyStorage.DcaInvestmentStruct[] = Array.from(
                { length: 11 },
                () => ({
                    // @dev percentage doesn't matter here, the investmentCount check happens before
                    percentage: 0,
                    poolId: 0,
                    swaps: 10,
                }),
            )

            const tx = strategyManager.connect(account0).createStrategy({
                dcaInvestments,
                vaultInvestments,
                liquidityInvestments: [],
                buyInvestments: [],
                permit: await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                metadataHash,
            })

            await expect(tx).to.be.revertedWithCustomError(strategyManager, 'LimitExceeded')
        })

        it('if total percentage is different than 100', async () => {
            const tx0 = strategyManager.connect(account0).createStrategy({
                dcaInvestments: [],
                vaultInvestments: [],
                liquidityInvestments: [],
                buyInvestments: [],
                permit: await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                metadataHash,
            })

            await expect(tx0).to.be.revertedWithCustomError(strategyManager, 'InvalidTotalPercentage')

            const tx1 = strategyManager.connect(account0).createStrategy({
                // 122%
                dcaInvestments: [...dcaStrategyPositions, ...dcaStrategyPositions],
                vaultInvestments: [],
                liquidityInvestments: [],
                buyInvestments: [],
                permit: await subscriptionSignature.signSubscriptionPermit(
                    await account0.getAddress(),
                    deadline,
                ),
                metadataHash,
            })

            await expect(tx1).to.be.revertedWithCustomError(strategyManager, 'InvalidTotalPercentage')
        })
    })
})
