import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { DollarCostAverage, StrategyManager, TestERC20, TestERC20__factory, UniswapPositionManager } from '@src/typechain'
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

    const dcaPositionToCollect = 0
    const liquidityPositionToCollect = 0
    // TODO move to constants
    const MaxUint128 = 2n ** 128n - 1n

    let dcaStrategyId: bigint
    let liquidityStrategyId: bigint

    let positionManagerUniV3: UniswapPositionManager

    const getDcaOutputTokenBalance = async () => dcaOutputToken.balanceOf(account1)
    const getDcaPositionBalances = async () => dca.getPositionBalances(strategyManager, 0)

    async function getUniV3PositionFees() {
        return positionManagerUniV3.collect.staticCall({
            tokenId: await positionManagerUniV3.tokenOfOwnerByIndex(strategyManager, 0),
            recipient: account1,
            amount0Max: MaxUint128,
            amount1Max: MaxUint128,
        }, { from: strategyManager })
    }

    async function getUniV3PositionTokens() {
        const { token0, token1 } = await positionManagerUniV3.positions(0)

        return {
            token0: TestERC20__factory.connect(token0),
            token1: TestERC20__factory.connect(token1),
        }
    }

    beforeEach(async () => {
        ({
            strategyManager,
            account1,
            account2,
            dca,
            dcaOutputToken,
            dcaStrategyId,
            liquidityStrategyId,
            positionManagerUniV3,
        } = await loadFixture(runStrategy))
    })

    describe('Given an investor with a position in a strategy which contains a DCA pool', () => {
        describe('Which contains a DCA pool', () => {
            describe('When the investor collects the position', () => {
                it('then increase DCA pool output token balance of investor', async () => {
                    const outputTokenBalanceBefore = await getDcaOutputTokenBalance()
                    const { outputTokenBalance } = await getDcaPositionBalances()

                    await strategyManager.connect(account1).collectPosition(dcaPositionToCollect)

                    const outputTokenBalanceDelta = await getDcaOutputTokenBalance() - outputTokenBalanceBefore

                    expect(outputTokenBalanceDelta).to.be.equals(outputTokenBalance)
                })

                it('then emit PositionCollected event', async () => {
                    const outputTokenBalances = await Promise.all(
                        (await dca.getPositions(strategyManager))
                            .map(async (_, id) => (await dca.getPositionBalances(strategyManager, id)).outputTokenBalance),
                    )

                    await expect(strategyManager.connect(account1).collectPosition(dcaPositionToCollect))
                        .to.emit(strategyManager, 'PositionCollected')
                        .withArgs(
                            await account1.getAddress(),
                            dcaStrategyId,
                            dcaPositionToCollect,
                            outputTokenBalances,
                            [],
                            [],
                        )
                })
            })
        })

        describe('Which contains a Liquidity pool', () => {
            describe('When the investor collects the position', () => {
                it.only('then increase liquidity pool output tokens balance of investor', async () => {
                    const { amount0, amount1 } = await getUniV3PositionFees()
                    const { token0, token1 } = await getUniV3PositionTokens()

                    const token0BalanceBefore = await token0.balanceOf(account1)
                    const token1BalanceBefore = await token1.balanceOf(account1)

                    console.log(token0BalanceBefore, token1BalanceBefore)

                    await strategyManager.connect(account1).collectPosition(liquidityPositionToCollect)

                    const token0BalanceDelta = await token0.balanceOf(account1) - token0BalanceBefore
                    const token1BalanceDelta = await token1.balanceOf(account1) - token1BalanceBefore

                    expect(token0BalanceDelta).to.be.equals(amount0)
                    expect(token1BalanceDelta).to.be.equals(amount1)
                })

                it('then emit PositionCollected event', async () => {
                    const outputTokenBalances = await Promise.all(
                        (await dca.getPositions(strategyManager))
                            .map(async (_, id) => (await dca.getPositionBalances(strategyManager, id)).outputTokenBalance),
                    )

                    await expect(strategyManager.connect(account1).collectPosition(liquidityPositionToCollect))
                        .to.emit(strategyManager, 'PositionCollected')
                        .withArgs(
                            await account1.getAddress(),
                            liquidityStrategyId,
                            liquidityPositionToCollect,
                            outputTokenBalances,
                            [],
                            [],
                        )
                })
            })
        })

        describe('When the investor collects the position but there is nothing to collect', () => {
            it('Then output token balance of investor should not change', async () => {
                await strategyManager.connect(account1).collectPosition(dcaPositionToCollect)

                // This first collect is called to collect all rewards
                await strategyManager.connect(account1).collectPosition(dcaPositionToCollect)
                const outputTokenBalanceBefore = await getDcaOutputTokenBalance()

                await strategyManager.connect(account1).collectPosition(dcaPositionToCollect)

                const outputTokenBalanceDelta = await getDcaOutputTokenBalance() - outputTokenBalanceBefore

                expect(outputTokenBalanceDelta).to.be.equals(0)
            })
        })
    })

    describe('Given an investor with no position', () => {
        describe('When the investor collects the position', () => {
            it('Then revert with InvalidPositionId', async () => {
                await expect(strategyManager.connect(account2).collectPosition(dcaPositionToCollect))
                    .to.be.revertedWithCustomError(strategyManager, 'InvalidPositionId')
                    .withArgs(
                        await account2.getAddress(),
                        dcaPositionToCollect,
                    )
            })
        })
    })
})
