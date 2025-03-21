import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { investFixture } from './fixtures/invest.fixture'
import { Signer } from 'ethers'
import { ERC20, StrategyManager__v2 } from '@src/typechain'

// EFFECTS
// => given a strategist with rewards to collect
//      => when the strategist collects the rewards
//          => then the strategist's balance increases proportionally to the rewards collected
//          => then the strategist's rewards is set to zero
//          => then emits a CollectedStrategistRewards event
// => given a strategist with no rewards to collect
//     => when the strategist collects the rewards
//          => then the strategist's balance remains unchanged
//          => then emits a CollectedStrategistRewards event
describe('StrategyManager#collectStrategistRewards', () => {
    /** strategist */
    let account0: Signer
    /** Subscribed Investor */
    let account1: Signer

    let strategyManager: StrategyManager__v2
    let stablecoin: ERC20

    const strategistBalance = async () => stablecoin.balanceOf(account0)

    beforeEach(async () => {
        ({
            account0,
            account1,
            strategyManager,
            stablecoin,
        } = await loadFixture(investFixture))
    })

    describe('given a strategist with rewards to collect', () => {
        describe('when the strategist collects the rewards', () => {
            it('then the strategist\'s balance increases proportionally to the rewards collected', async () => {
                const balanceBefore = await strategistBalance()
                const toCollect = await strategyManager.getStrategistRewards(account0)

                await strategyManager.connect(account0).collectStrategistRewards()
                const balanceDelta = (await strategistBalance()) - balanceBefore

                // ensures the test is set up properly
                expect(toCollect).to.be.greaterThan(0n)
                expect(balanceDelta).to.equal(toCollect)
            })

            it('then the strategist\'s rewards is set to zero', async () => {
                await strategyManager.connect(account0).collectStrategistRewards()
                expect(await strategyManager.getStrategistRewards(account0)).to.equal(0n)
            })

            it('then emits a CollectedStrategistRewards event', async () => {
                const toCollect = await strategyManager.getStrategistRewards(account0)

                await expect(strategyManager.connect(account0).collectStrategistRewards())
                    .to.emit(strategyManager, 'CollectedStrategistRewards')
                    .withArgs(account0, toCollect)
            })

            it('calculates rewards properly', async () => {
                expect(await strategyManager.getStrategistRewards(account0))
                    .to.equal(await stablecoin.balanceOf(strategyManager))

                await strategyManager.connect(account0).collectStrategistRewards()

                expect(await strategyManager.getStrategistRewards(account0))
                    .to.equal(0)

                expect(await stablecoin.balanceOf(strategyManager))
                    .to.equal(0)
            })
        })
    })

    // account1 doesn't have any strategy with deposits
    describe('given a strategist with no rewards to collect', () => {
        describe('when the strategist collects the rewards', () => {
            it('then the strategist\'s balance remains unchanged', async () => {
                const balanceBefore = await strategistBalance()

                await strategyManager.connect(account1).collectStrategistRewards()
                expect(await strategistBalance()).to.equal(balanceBefore)
            })

            it('then emits a CollectedStrategistRewards event', async () => {
                await expect(strategyManager.connect(account1).collectStrategistRewards())
                    .to.emit(strategyManager, 'CollectedStrategistRewards')
                    .withArgs(await account1.getAddress(), 0n)
            })
        })
    })
})
