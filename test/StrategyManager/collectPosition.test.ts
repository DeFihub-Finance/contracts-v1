import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    StrategyManager__v4,
    StrategyPositionManager,
    TestERC20,
    UniswapPositionManager,
    UniswapV3Factory,
} from '@src/typechain'
import {  Signer } from 'ethers'
import { runStrategy } from './fixtures/run-strategy.fixture'
import {
    expectCustomError,
    getEventLog,
    getAccountBalanceMap,
    LiquidityHelpers,
    getStrategyBalanceMap,
    StrategyBalanceModes,
    getAllFeeEventLogs,
    getAccountRewardsMap,
    getRewardsDistributionFeeEvents,
} from '@src/helpers'
import { FeeTo } from '@defihub/shared'

/*
    => Given an investor with a position in a strategy
        => Which contains a DCA pool
            => When the investor collects the position
                => Then increase DCA pool output token balance of investor
                => Then emits PositionCollected event
        => Which contains a Liquidity Position
            => When the investor collects the position
                => Then increase balance of investor from liquidity position fees
                => Then distribute liquidity reward fee to strategist and treasury
                => Then emit Fee event to strategist and treasury
                => Then emit PositionCollected event
        => When the investor collects the position but there is nothing to collect
            => Then output token balance of investor should not change
                => Works for DCA
                => Works for Buy

    => Given an investor with no position
        => When the investor collects the position
            => Then revert with InvalidPositionId
*/
describe('StrategyManager#collectPosition', () => {
    let strategyManager: StrategyManager__v4
    let strategyPositionManager: StrategyPositionManager
    let dca: DollarCostAverage
    let account0: Signer
    let account1: Signer
    let account2: Signer
    let treasury: Signer

    let weth: TestERC20
    let dcaOutputToken: TestERC20

    let dcaStrategyId: bigint
    let liquidityStrategyId: bigint

    let dcaPositionId: bigint
    let liquidityPositionId: bigint
    let buyOnlyStrategyPositionId: bigint

    let positionManagerUniV3: UniswapPositionManager
    let factoryUniV3: UniswapV3Factory

    function _getStrategyBalanceMap(
        strategyId: bigint,
        strategyPositionId: bigint,
    ) {
        return getStrategyBalanceMap(
            strategyManager,
            dca,
            factoryUniV3,
            account1,
            strategyId,
            strategyPositionId,
            StrategyBalanceModes.REWARDS,
        )
    }

    beforeEach(async () => {
        ({
            strategyManager,
            strategyPositionManager,
            account0,
            account1,
            account2,
            treasury,
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
                    const positionTokenCollectables = await _getStrategyBalanceMap(dcaStrategyId, dcaPositionId)
                    const collectableTokens = new Set(Object.keys(positionTokenCollectables))
                    const userTokenBalancesBefore = await getAccountBalanceMap(collectableTokens, account1)

                    await strategyManager.connect(account1).collectPosition(dcaPositionId)

                    const userTokenBalancesAfter = await getAccountBalanceMap(collectableTokens, account1)

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
                    const positionCollectedEvent = getEventLog(receipt, 'PositionCollected', strategyPositionManager.interface)

                    expect(positionCollectedEvent?.args).to.deep.equal([
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

        describe('Which contains a Liquidity Position', () => {
            describe('When the investor collects the position', () => {
                it('then increase balance of investor from liquidity position fees', async () => {
                    const positionTokenCollectables = await _getStrategyBalanceMap(
                        liquidityStrategyId,
                        liquidityPositionId,
                    )
                    const tokens = new Set(Object.keys(positionTokenCollectables))
                    const userTokenBalancesBefore = await getAccountBalanceMap(tokens, account1)

                    await strategyManager.connect(account1).collectPosition(liquidityPositionId)

                    const userTokenBalancesAfter = await getAccountBalanceMap(tokens, account1)

                    for (const token of tokens) {
                        expect(userTokenBalancesAfter[token] - userTokenBalancesBefore[token])
                            .to.equal(positionTokenCollectables[token])
                    }
                })

                it('then distribute liquidity reward fees to strategist and treasury ', async () => {
                    const positionsFees = await LiquidityHelpers.getPositionFeeAmounts(
                        liquidityStrategyId,
                        liquidityPositionId,
                        account1,
                        strategyManager,
                    )
                    const tokens = new Set(positionsFees.flatMap(fees => fees.tokens))

                    const feesByFeeToAndToken = positionsFees.reduce<Record<number, Record<string, bigint>>>((acc, fees) => {
                        for (let index = 0; index < fees.tokens.length; index++) {
                            const token = fees.tokens[index]
                            const protocolFee = fees[FeeTo.PROTOCOL][index]
                            const strategistFee = fees[FeeTo.STRATEGIST][index]

                            acc[FeeTo.PROTOCOL][token] = (acc[FeeTo.PROTOCOL][token] || BigInt(0)) + protocolFee
                            acc[FeeTo.STRATEGIST][token] = (acc[FeeTo.STRATEGIST][token] || BigInt(0)) + strategistFee
                        }

                        return acc
                    }, {
                        [FeeTo.PROTOCOL]: {},
                        [FeeTo.STRATEGIST]: {},
                    })

                    const [
                        treasuryRewardBalancesBefore,
                        strategistRewardBalancesBefore,
                    ] = await Promise.all([
                        getAccountRewardsMap(treasury, tokens, strategyManager),
                        getAccountRewardsMap(account0, tokens, strategyManager),
                    ])

                    await strategyManager.connect(account1).collectPosition(liquidityPositionId)

                    const [
                        treasuryRewardBalancesAfter,
                        strategistRewardBalancesAfter,
                    ] = await Promise.all([
                        getAccountRewardsMap(treasury, tokens, strategyManager),
                        getAccountRewardsMap(account0, tokens, strategyManager),
                    ])

                    for (const token of tokens) {
                        expect(strategistRewardBalancesAfter[token] - strategistRewardBalancesBefore[token])
                            .to.equal(feesByFeeToAndToken[FeeTo.STRATEGIST][token])

                        expect(treasuryRewardBalancesAfter[token] - treasuryRewardBalancesBefore[token])
                            .to.equal(feesByFeeToAndToken[FeeTo.PROTOCOL][token])
                    }
                })

                it('then emit Fee event to strategist and treasury', async () => {
                    const expectedFeeEvents = await getRewardsDistributionFeeEvents(
                        treasury,
                        account1,
                        account0,
                        liquidityStrategyId,
                        liquidityPositionId,
                        strategyManager,
                    )

                    const receipt = await (
                        await strategyManager.connect(account1).collectPosition(liquidityPositionId)
                    ).wait()

                    const feeEvents = getAllFeeEventLogs(receipt)

                    expect(feeEvents?.length).to.be.greaterThan(0)
                    feeEvents?.forEach((event, index) => expect(event.args).to.deep.equal(expectedFeeEvents[index]))
                })

                it('then emit PositionCollected event', async () => {
                    const investments = await strategyManager.getPositionInvestments(account1, liquidityPositionId)
                    const liquidityRewardFeeBP = await strategyManager.getLiquidityRewardFee(liquidityStrategyId)

                    const liquidityWithdrawAmounts = await Promise.all(
                        investments.liquidityPositions.map(async position => {
                            const { amount0, amount1 } = await LiquidityHelpers.getDeductedPositionFees(
                                position.tokenId,
                                liquidityRewardFeeBP,
                                positionManagerUniV3,
                                strategyManager,
                            )

                            return [amount0, amount1]
                        }),
                    )

                    const receipt = await (await strategyManager.connect(account1).collectPosition(liquidityPositionId)).wait()
                    const positionCollectedEvent = getEventLog(receipt, 'PositionCollected', strategyPositionManager.interface)

                    expect(positionCollectedEvent?.args).to.deep.equal([
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
