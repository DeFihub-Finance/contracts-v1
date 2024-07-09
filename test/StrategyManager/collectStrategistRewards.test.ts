import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { investFixture } from './fixtures/invest.fixture'
import { Signer } from 'ethers'
import { ERC20, StrategyManager, ZapManager } from '@src/typechain'

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
    let account0: Signer
    let account1: Signer
    let strategyManager: StrategyManager
    let zapManager: ZapManager
    let stablecoin: ERC20
    let strategistAddress: string

    const strategistBalance = async () => stablecoin.balanceOf(await account0.getAddress())

    beforeEach(async () => {
        ({
            account0,
            account1,
            strategyManager,
            strategistAddress,
            zapManager,
            stablecoin,
        } = await loadFixture(investFixture))
    })

    describe('given a strategist with rewards to collect', () => {
        describe('when the strategist collects the rewards', () => {
            it('then the strategist\'s balance increases proportionally to the rewards collected', async () => {
                const balanceBefore = await strategistBalance()
                const toCollect = await strategyManager.getStrategistRewards(strategistAddress)

                await strategyManager.connect(account0).collectStrategistRewards()
                const balanceDelta = (await strategistBalance()) - balanceBefore

                // ensures the test is set up properly
                expect(toCollect).to.be.greaterThan(0n)
                expect(balanceDelta).to.equal(toCollect)
            })

            it('then the strategist\'s rewards is set to zero', async () => {
                await strategyManager.connect(account0).collectStrategistRewards()
                expect(await strategyManager.getStrategistRewards(strategistAddress)).to.equal(0n)
            })

            it('then emits a CollectedStrategistRewards event', async () => {
                const toCollect = await strategyManager.getStrategistRewards(strategistAddress)

                await expect(strategyManager.connect(account0).collectStrategistRewards())
                    .to.emit(strategyManager, 'CollectedStrategistRewards')
                    .withArgs(strategistAddress, toCollect)
            })

            it('calculates rewards properly', async () => {
                expect(
                    await strategyManager.getStrategistRewards(account0) +
                    await stablecoin.balanceOf(zapManager) -
                    await stablecoin.balanceOf(strategyManager),
                ).to.equal(0)

                await strategyManager.connect(account0).collectStrategistRewards()

                expect(await strategyManager.getStrategistRewards(account0))
                    .to.equal(0)

                expect(
                    await stablecoin.balanceOf(zapManager) -
                    await stablecoin.balanceOf(strategyManager),
                )
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
