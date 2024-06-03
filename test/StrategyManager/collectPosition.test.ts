import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { DollarCostAverage, StrategyManager, TestERC20 } from '@src/typechain'
import { Signer } from 'ethers'
import { runStrategy } from './fixtures/run-strategy.fixture'

// => Given an investor with a position in a strategy which contains a DCA pool
//      => When the investor collects the position
//          => Then the DCA pool input token balance of the investor should increase by the position's output token balance
//          => Then emits PositionCollected event
//      => When the investor collects the position but there is nothing to collect
//          => Then output token balance of the investor should not change
//
// => Given an investor with no position
//     => When the investor collects the position
//          => Then revert with InvalidPositionId
describe('StrategyManager#collectPosition', () => {
    let strategyManager: StrategyManager
    let dca: DollarCostAverage
    let account1: Signer
    let account2: Signer
    let dcaOutputToken: TestERC20

    const positionToCollect = 0
    const strategyIdToCollect = 0

    const getDcaOutputTokenBalance = async () => dcaOutputToken.balanceOf(await account1.getAddress())
    const getDcaPositionBalances = async () => dca.getPositionBalances(await strategyManager.getAddress(), 0)

    beforeEach(async () => {
        ({
            strategyManager,
            account1,
            account2,
            dca,
            dcaOutputToken,
        } = await loadFixture(runStrategy))
    })

    describe('Given an investor with a position in a strategy which contains a DCA pool', () => {
        describe('When the investor collects the position', () => {
            it('then increase DCA pool output token balance of investor', async () => {
                const outputTokenBalanceBefore = await getDcaOutputTokenBalance()
                const { outputTokenBalance } = await getDcaPositionBalances()

                await strategyManager.connect(account1).collectPosition(positionToCollect)

                const outputTokenBalanceDelta = await getDcaOutputTokenBalance() - outputTokenBalanceBefore

                expect(outputTokenBalanceDelta).to.be.equals(outputTokenBalance)
            })

            it('then emit PositionCollected event', async () => {
                const outputTokenBalances = await Promise.all(
                    (await dca.getPositions(strategyManager))
                        .map(async (_, id) => (await dca.getPositionBalances(strategyManager, id)).outputTokenBalance)
                )

                await expect(strategyManager.connect(account1).collectPosition(positionToCollect))
                    .to.emit(strategyManager, 'PositionCollected')
                    .withArgs(
                        await account1.getAddress(),
                        strategyIdToCollect,
                        positionToCollect,
                        outputTokenBalances,
                    )
            })
        })

        describe('When the investor collects the position but there is nothing to collect', () => {
            it('Then output token balance of investor should not change', async () => {
                await strategyManager.connect(account1).collectPosition(positionToCollect)

                // This first collect is called to collect all rewards
                await strategyManager.connect(account1).collectPosition(positionToCollect)
                const outputTokenBalanceBefore = await getDcaOutputTokenBalance()

                await strategyManager.connect(account1).collectPosition(positionToCollect)

                const outputTokenBalanceDelta = await getDcaOutputTokenBalance() - outputTokenBalanceBefore

                expect(outputTokenBalanceDelta).to.be.equals(0)
            })
        })
    })

    describe('Given an investor with no position', () => {
        describe('When the investor collects the position', () => {
            it('Then revert with InvalidPositionId', async () => {
                await expect(strategyManager.connect(account2).collectPosition(positionToCollect))
                    .to.be.revertedWithCustomError(strategyManager, 'InvalidPositionId')
                    .withArgs(
                        await account2.getAddress(),
                        positionToCollect,
                    )
            })
        })
    })
})
