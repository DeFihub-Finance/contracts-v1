import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    StrategyManager__v2,
    StrategyPositionManager,
    TestERC20,
    TestERC20__factory,
    UniswapPositionManager,
    UniswapV3Factory,
} from '@src/typechain'
import { AddressLike, Signer } from 'ethers'
import { runStrategy } from './fixtures/run-strategy.fixture'
import { expectCustomError, getEventLog, LiquidityHelpers } from '@src/helpers'

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
    let strategyManager: StrategyManager__v2
    let strategyPositionManager: StrategyPositionManager
    let dca: DollarCostAverage
    let account1: Signer
    let account2: Signer
    let weth: TestERC20
    let dcaOutputToken: TestERC20

    let dcaStrategyId: bigint
    let liquidityStrategyId: bigint

    let dcaPositionId: bigint
    let liquidityPositionId: bigint
    let buyOnlyStrategyPositionId: bigint

    let positionManagerUniV3: UniswapPositionManager
    let factoryUniV3: UniswapV3Factory

    async function snapshotStrategyTokenCollectables(strategyPositionId: bigint) {
        const positionTokenCollectables: Record<string, bigint> = {}

        const { dcaPositions, liquidityPositions } = await strategyManager.getPositionInvestments(
            account1,
            strategyPositionId,
        )

        function addOrCreateBalance(token: string, balance: bigint) {
            if (positionTokenCollectables[token])
                positionTokenCollectables[token] = balance + positionTokenCollectables[token]
            else
                positionTokenCollectables[token] = balance
        }

        for (const positionId of dcaPositions) {
            const [
                { outputTokenBalance },
                { poolId },
            ]= await Promise.all([
                dca.getPositionBalances(strategyManager, positionId),
                dca.getPosition(strategyManager, positionId),
            ])

            const { outputToken } = await dca.getPool(poolId)

            addOrCreateBalance(outputToken, outputTokenBalance)
        }

        for (const position of liquidityPositions) {
            const {
                fees,
                token0,
                token1,
            } = await LiquidityHelpers.getLiquidityPositionInfo(
                position.tokenId,
                positionManagerUniV3,
                factoryUniV3,
                strategyManager,
            )

            addOrCreateBalance(token0, fees.amount0)
            addOrCreateBalance(token1, fees.amount1)
        }

        return positionTokenCollectables
    }

    async function snapshotUserTokenBalances(tokens: Set<string>, account: AddressLike) {
        const userTokenBalancesBefore: Record<string, bigint> = {}

        await Promise.all(
            Array.from(tokens).map(async token => {
                userTokenBalancesBefore[token] = await TestERC20__factory
                    .connect(token, account1)
                    .balanceOf(account)
            }),
        )

        return userTokenBalancesBefore
    }

    beforeEach(async () => {
        ({
            strategyManager,
            strategyPositionManager,
            account1,
            account2,
            weth,
            dca,
            dcaOutputToken,
            dcaStrategyId,
            liquidityStrategyId,
            dcaPositionId,
            liquidityPositionId,
            buyOnlyStrategyPositionId,
            positionManagerUniV3,
            factoryUniV3,
        } = await loadFixture(runStrategy))
    })

    describe('Given an investor with a position in a strategy', () => {
        describe('Which contains a DCA pool', () => {
            describe('When the investor collects the position', () => {
                it('then increase DCA pool output token balance of investor', async () => {
                    const positionTokenCollectables = await snapshotStrategyTokenCollectables(dcaPositionId)
                    const collectableTokens = new Set(Object.keys(positionTokenCollectables))
                    const userTokenBalancesBefore = await snapshotUserTokenBalances(collectableTokens, account1)

                    await strategyManager.connect(account1).collectPosition(dcaPositionId)

                    const userTokenBalancesAfter = await snapshotUserTokenBalances(collectableTokens, account1)

                    for (const token of collectableTokens) {
                        expect(userTokenBalancesAfter[token] - userTokenBalancesBefore[token]).to.equal(
                            positionTokenCollectables[token],
                        )
                    }
                })

                it('then emit PositionCollected event', async () => {
                    const outputTokenBalances = await Promise.all(
                        (await dca.getPositions(strategyManager))
                            .map(async (_, id) => (await dca.getPositionBalances(strategyManager, id)).outputTokenBalance),
                    )

                    const receipt = await (await strategyManager.connect(account1).collectPosition(dcaPositionId)).wait()
                    const feeEvent = getEventLog(receipt, 'PositionCollected', strategyPositionManager.interface)

                    expect(feeEvent?.args).to.deep.equal([
                        await account1.getAddress(),
                        dcaStrategyId,
                        dcaPositionId,
                        outputTokenBalances,
                        [],
                        [],
                    ])
                })
            })
        })

        describe('Which contains a Liquidity pool', () => {
            describe('When the investor collects the position', () => {
                it('then increase liquidity pool output tokens balance of investor', async () => {
                    const positionTokenCollectables = await snapshotStrategyTokenCollectables(liquidityPositionId)
                    const tokens = new Set(Object.keys(positionTokenCollectables))
                    const userTokenBalancesBefore = await snapshotUserTokenBalances(tokens, account1)

                    await strategyManager.connect(account1).collectPosition(liquidityPositionId)

                    const userTokenBalancesAfter = await snapshotUserTokenBalances(tokens, account1)

                    for (const token of tokens) {
                        expect(userTokenBalancesAfter[token] - userTokenBalancesBefore[token])
                            .to.equal(positionTokenCollectables[token])
                    }
                })

                it('then emit PositionCollected event', async () => {
                    const liquidityWithdrawAmounts = (await Promise.all(
                        (await strategyManager.getPositionInvestments(account1, liquidityPositionId))
                            .liquidityPositions.map(position => LiquidityHelpers.getLiquidityPositionInfo(
                                position.tokenId,
                                positionManagerUniV3,
                                factoryUniV3,
                                strategyManager,
                            )),
                    )).map(({ fees }) => ([fees.amount0, fees.amount1]))

                    const receipt = await (await strategyManager.connect(account1).collectPosition(liquidityPositionId)).wait()
                    const feeEvent = getEventLog(receipt, 'PositionCollected', strategyPositionManager.interface)

                    expect(feeEvent?.args).to.deep.equal([
                        await account1.getAddress(),
                        liquidityStrategyId,
                        liquidityPositionId,
                        [],
                        liquidityWithdrawAmounts,
                        [],
                    ])
                })
            })
        })

        describe('When the investor collects the position but there is nothing to collect', () => {
            describe('Then output token balance of investor should not change', () => {
                it('Works for DCA', async () => {
                    await strategyManager.connect(account1).collectPosition(dcaPositionId)

                    // This first collect is called to collect all rewards
                    await strategyManager.connect(account1).collectPosition(dcaPositionId)
                    const initialOutputTokenBalance = await dcaOutputToken.balanceOf(account1)

                    await strategyManager.connect(account1).collectPosition(dcaPositionId)

                    expect(initialOutputTokenBalance).to.be.equal(await dcaOutputToken.balanceOf(account1))
                })

                it('Works for Buy', async () => {
                    expect((await strategyManager.getPositionInvestments(account1, buyOnlyStrategyPositionId)).buyPositions.length).to.equal(1)

                    const initialEthBalance = await weth.balanceOf(account1)

                    await strategyManager.connect(account1).collectPosition(buyOnlyStrategyPositionId)

                    const ethBalanceAfterCollect = await weth.balanceOf(account1)

                    expect(initialEthBalance).to.be.lessThan(ethBalanceAfterCollect)
                    expect((await strategyManager.getPositionInvestments(account1, buyOnlyStrategyPositionId)).buyPositions.length).to.equal(0)

                    await strategyManager.connect(account1).collectPosition(buyOnlyStrategyPositionId)

                    expect(ethBalanceAfterCollect).to.be.equal(await weth.balanceOf(account1))
                })
            })
        })
    })

    describe('Given an investor with no position', () => {
        describe('When the investor collects the position', () => {
            it('Then revert with InvalidPositionId', async () => {
                await expectCustomError(
                    strategyManager.connect(account2).collectPosition(dcaPositionId),
                    'InvalidPositionId',
                )
            })
        })
    })
})
