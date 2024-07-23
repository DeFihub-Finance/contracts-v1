import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { DollarCostAverage, StrategyManager, TestERC20, TestERC20__factory, UniswapPositionManager } from '@src/typechain'
import { Signer } from 'ethers'
import { runStrategy } from './fixtures/run-strategy.fixture'
import { ethers } from 'hardhat'
import { UniswapV3 } from '@src/helpers'

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

    let dcaPositionId: bigint
    let liquidityPositionId: bigint

    let dcaStrategyId: bigint
    let liquidityStrategyId: bigint

    let positionManagerUniV3: UniswapPositionManager

    const getDcaOutputTokenBalance = async () => dcaOutputToken.balanceOf(account1)
    const getDcaPositionBalances = async () => dca.getPositionBalances(strategyManager, 0)

    async function getUniV3PositionTokens() {
        const { token0, token1 } = await positionManagerUniV3.positions(
            await positionManagerUniV3.tokenOfOwnerByIndex(strategyManager, 0),
        )

        return {
            token0: TestERC20__factory.connect(token0, ethers.provider),
            token1: TestERC20__factory.connect(token1, ethers.provider),
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
            dcaPositionId,
            liquidityPositionId,
            positionManagerUniV3,
        } = await loadFixture(runStrategy))
    })

    describe('Given an investor with a position in a strategy which contains a DCA pool', () => {
        describe('Which contains a DCA pool', () => {
            describe('When the investor collects the position', () => {
                it('then increase DCA pool output token balance of investor', async () => {
                    const outputTokenBalanceBefore = await getDcaOutputTokenBalance()
                    const { outputTokenBalance } = await getDcaPositionBalances()

                    await strategyManager.connect(account1).collectPosition(dcaPositionId)

                    const outputTokenBalanceDelta = await getDcaOutputTokenBalance() - outputTokenBalanceBefore

                    expect(outputTokenBalanceDelta).to.be.equals(outputTokenBalance)
                })

                it('then emit PositionCollected event', async () => {
                    const outputTokenBalances = await Promise.all(
                        (await dca.getPositions(strategyManager))
                            .map(async (_, id) => (await dca.getPositionBalances(strategyManager, id)).outputTokenBalance),
                    )

                    await expect(strategyManager.connect(account1).collectPosition(dcaPositionId))
                        .to.emit(strategyManager, 'PositionCollected')
                        .withArgs(
                            await account1.getAddress(),
                            dcaStrategyId,
                            dcaPositionId,
                            outputTokenBalances,
                            [],
                            [],
                        )
                })
            })
        })

        describe('Which contains a Liquidity pool', () => {
            describe('When the investor collects the position', () => {
                it('then increase liquidity pool output tokens balance of investor', async () => {
                    const { amount0, amount1 } = await UniswapV3.getPositionFees(
                        await positionManagerUniV3.tokenOfOwnerByIndex(strategyManager, 0),
                        positionManagerUniV3,
                        account1,
                        strategyManager,
                    )

                    const { token0, token1 } = await getUniV3PositionTokens()

                    const userBalanceToken0 = await token0.balanceOf(account1)
                    const userBalanceToken1 = await token1.balanceOf(account1)

                    await strategyManager.connect(account1).collectPosition(liquidityPositionId)

                    const userBalanceToken0Delta = await token0.balanceOf(account1) - userBalanceToken0
                    const userBalanceToken1Delta = await token1.balanceOf(account1) - userBalanceToken1

                    expect(userBalanceToken0Delta).to.be.equals(amount0)
                    expect(userBalanceToken1Delta).to.be.equals(amount1)
                })

                it('then emit PositionCollected event', async () => {
                    const { amount0, amount1 } = await UniswapV3.getPositionFees(
                        await positionManagerUniV3.tokenOfOwnerByIndex(strategyManager, 0),
                        positionManagerUniV3,
                        account1,
                        strategyManager,
                    )

                    await expect(strategyManager.connect(account1).collectPosition(liquidityPositionId))
                        .to.emit(strategyManager, 'PositionCollected')
                        .withArgs(
                            await account1.getAddress(),
                            liquidityStrategyId,
                            liquidityPositionId,
                            [],
                            [[amount0, amount1]],
                            [],
                        )
                })
            })
        })

        describe('When the investor collects the position but there is nothing to collect', () => {
            it('Then output token balance of investor should not change', async () => {
                await strategyManager.connect(account1).collectPosition(dcaPositionId)

                // This first collect is called to collect all rewards
                await strategyManager.connect(account1).collectPosition(dcaPositionId)
                const outputTokenBalanceBefore = await getDcaOutputTokenBalance()

                await strategyManager.connect(account1).collectPosition(dcaPositionId)

                const outputTokenBalanceDelta = await getDcaOutputTokenBalance() - outputTokenBalanceBefore

                expect(outputTokenBalanceDelta).to.be.equals(0)
            })
        })
    })

    describe('Given an investor with no position', () => {
        describe('When the investor collects the position', () => {
            it('Then revert with InvalidPositionId', async () => {
                await expect(strategyManager.connect(account2).collectPosition(dcaPositionId))
                    .to.be.revertedWithCustomError(strategyManager, 'InvalidPositionId')
                    .withArgs(
                        await account2.getAddress(),
                        dcaPositionId,
                    )
            })
        })
    })
})
