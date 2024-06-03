import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { StrategyManager } from '@src/typechain'
import { baseStrategyManagerFixture } from './fixtures/base.fixture'

// => setStrategistPercentage
//      => when strategist percentege is greater than 100
//          => then reverts with PercentageTooHigh
//      => when strategist percentege is less than or equal to 100
//          => then sets strategis percentage to 99
//          => then sets strategis percentage to 100
//          => then emits StrategistPercentageUpdated
// => setHotStrategistPercentage
//      => when hot strategy percentage is greater than 100
//          => then reverts with PercentageTooHigh
//      => when hot strategy percentege is less than or equal to 100
//          => then sets hot strategy percentage to 99
//          => then sets hot strategy percentage to 100
//          => then emits event HotStrategistPercentageUpdated
// => setHottestStrategies
//      => when list of strategies is larger than max hottest strategies
//          => then reverts with TooManyUsers
//      => when list of strategies is smaller than max hottest strategies
//          => then sets old strategies to not hot
//          => then sets the new strategies to hot
//          => then emits HottestStrategiesUpdated
// => setMaxHottestStrategies
//      => should set max strategy hot strategy
//      => should emit MaxHotStrategiesUpdated
describe('StrategyManager#setters', () => {
    let strategyManager: StrategyManager

    beforeEach(async () => ({ strategyManager } = await loadFixture(baseStrategyManagerFixture)))

    describe('#setStrategistPercentage', () => {
        describe('when strategist percentege is greater than 100', () => {
            it('then reverts with PercentageTooHigh', async () => {
                const newPercentage = 101n
                const tx = strategyManager.setStrategistPercentage(newPercentage)

                await expect(tx).to.revertedWithCustomError(strategyManager, 'PercentageTooHigh')
            })
        })

        describe('when strategist percentege is less than or equal to 100', () => {
            it('then set strategies percentage to 99', async () => {
                const newPercentage = 99n

                await strategyManager.setStrategistPercentage(newPercentage)

                await expect(strategyManager.strategistPercentage()).to.become(newPercentage)
            })

            it('then sets strategies percentage to 100 ', async () => {
                const newPercentage = 100n

                await strategyManager.setStrategistPercentage(newPercentage)

                await expect(strategyManager.strategistPercentage()).to.become(newPercentage)
            })

            it('then emits StrategistPercentageUpdated', async () => {
                const newPercentage = 10n
                const tx = strategyManager.setStrategistPercentage(newPercentage)

                await expect(tx)
                    .to.emit(strategyManager, 'StrategistPercentageUpdated')
                    .withArgs(newPercentage)
            })
        })
    })

    describe('#setHotStrategistPercentage', () => {
        describe('when hot strategy percentage is greater than 100', () => {
            it('then reverts with PercentageTooHigh', async () => {
                const newPercentage = 101n
                const tx = strategyManager.setHotStrategistPercentage(newPercentage)

                await expect(tx).to.revertedWithCustomError(strategyManager, 'PercentageTooHigh')
            })
        })

        describe('when hot strategy percentege is less than or equal to 100', () => {
            it('then sets hot strategy percentage to 99', async () => {
                const newPercentage = 99n

                await strategyManager.setHotStrategistPercentage(newPercentage)

                await expect(strategyManager.hotStrategistPercentage()).to.become(newPercentage)
            })

            it('then sets hot strategy percentage to 100', async () => {
                const newPercentage = 100n

                await strategyManager.setHotStrategistPercentage(newPercentage)

                await expect(strategyManager.hotStrategistPercentage()).to.become(newPercentage)
            })

            it('then emits event HotStrategistPercentageUpdated', async () => {
                const newPercentage = 10n
                const tx = strategyManager.setHotStrategistPercentage(newPercentage)

                await expect(tx)
                    .to.emit(strategyManager, 'HotStrategistPercentageUpdated')
                    .withArgs(newPercentage)
            })
        })
    })

    describe('#setHottestStrategies', () => {
        describe('when list of strategies is larger than max hottest strategies', () => {
            it('then revert with TooManyUsers', async () => {
                const strategyIds = new Array(11).fill(0).map((_, index) => index)

                const tx = strategyManager.setHottestStrategies(strategyIds)

                await expect(tx).to.revertedWithCustomError(strategyManager, 'TooManyUsers')
            })
        })

        describe('when list of strategies is smaller than max hottest strategies', () => {
            const strategyIds = new Array(10).fill(0).map((_, index) => index)
            const newHottest = strategyIds.map(id => id + 10)

            it('then sets old strategies to not hot', async () => {
                await strategyManager.setHottestStrategies(strategyIds)
                await strategyManager.setHottestStrategies(newHottest)

                await Promise.all(strategyIds.map(async id =>
                    expect(await strategyManager.isHot(id)).to.be.false))
            })

            it('then sets the new strategies to hot', async () => {
                await strategyManager.setHottestStrategies(newHottest)

                await Promise.all(newHottest.map(async id =>
                    expect(await strategyManager.isHot(id)).to.be.true))
            })

            it('then emits HottestStrategiesUpdated', async () => {
                const tx = strategyManager.setHottestStrategies(strategyIds)

                await expect(tx)
                    .to.emit(strategyManager, 'HottestStrategiesUpdated')
                    .withArgs(strategyIds)
            })
        })
    })

    describe('#setMaxHottestStrategies', () => {
        it('should set max strategy hot strategy', async () => {
            const newMax = 100n

            await strategyManager.setMaxHottestStrategies(newMax)
            await expect(strategyManager.maxHottestStrategies()).to.become(newMax)
        })

        it('should emit MaxHotStrategiesUpdated', async () => {
            const newMax = 100n
            const tx = strategyManager.setMaxHottestStrategies(newMax)

            await expect(tx)
                .to.emit(strategyManager, 'MaxHotStrategiesUpdated')
                .withArgs(newMax)
        })
    })
})
