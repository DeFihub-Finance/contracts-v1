import { expect } from 'chai'
import { FeeTo, UniswapV3, unwrapAddressLike } from '@defihub/shared'
import { Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    StrategyManager__v4,
    StrategyPositionManager,
    UniswapPositionManager,
    UniswapV3Factory,
} from '@src/typechain'
import { runStrategy } from './fixtures/run-strategy.fixture'
import {
    expectCustomError,
    getEventLog,
    getAccountBalanceMap,
    LiquidityHelpers,
    UniswapV3 as UniswapV3Helpers,
    getStrategyBalanceMap,
    StrategyBalanceModes,
    getAccountRewardsMap,
    getRewardsDistributionFeeEvents,
    getAllFeeEventLogs,
    mapPositionsFeesByFeeToAndToken,
} from '@src/helpers'

/*
    => Given an open position with only DCA
        => When the owner of position calls closePosition
            => Then the user receives remaining tokens of all DCA positions in a strategy
            => Then position should be marked as closed

    => Given an open position with only liquidity
        => When the owner of position calls closePosition
            => Then liquidity reward fees are distributed to strategist and treasury
            => Then the user receives remaining tokens of all liquidity positions in a strategy
            => Then the contract emits Fee events to strategist and treasury
            => Then the contract emits a PositionClosed event
            => Then position should be marked as closed
        => When the owner of position calls closePositionIgnoringSlippage
            => Then the user receives remaining tokens of all positions in a strategy
            => Then the contract emits a PositionClosed event
            => Then position should be marked as closed

    => Given a closed position
        => When the owner of position calls closePosition
            => Then the contract reverts with PositionAlreadyClosed
*/
describe('StrategyManager#closePosition', () => {
    let treasury: Signer
    let account0: Signer
    let account1: Signer
    let dca: DollarCostAverage
    let strategyManager: StrategyManager__v4
    let strategyPositionManager: StrategyPositionManager

    let dcaPositionId: bigint

    let liquidityPositionId: bigint
    let liquidityStrategyId: bigint

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
            StrategyBalanceModes.ALL,
        )
    }

    async function getLiquidityMinOutputs(strategyPositionId: bigint) {
        const { liquidityPositions } = await strategyManager.getPositionInvestments(account1, strategyPositionId)

        return Promise.all(liquidityPositions.map(async ({ tokenId }) => {
            const position = await positionManagerUniV3.positions(tokenId)

            return UniswapV3.getBurnAmounts(
                await UniswapV3Helpers.getPoolByFactoryContract(
                    factoryUniV3,
                    position.token0,
                    position.token1,
                    position.fee,
                ),
                position.liquidity,
                position.tickLower,
                position.tickUpper,
            )
        }))
    }

    async function getLiquidityWithdrawnAmounts(strategyId: bigint, strategyPositionId: bigint) {
        const [
            liquidityRewardFeeBP,
            { liquidityPositions },
        ] = await Promise.all([
            strategyManager.getLiquidityRewardFee(strategyId),
            strategyManager.getPositionInvestments(account1, strategyPositionId),
        ])

        return Promise.all(liquidityPositions.map(async position => {
            const {
                amount0,
                amount1,
                fees,
            } = await LiquidityHelpers.getLiquidityPositionInfo(
                position.tokenId,
                liquidityRewardFeeBP,
                positionManagerUniV3,
                factoryUniV3,
                strategyManager,
            )

            return [amount0 + fees.amount0, amount1 + fees.amount1]
        }))
    }

    beforeEach(async () => {
        ({
            strategyManager,
            strategyPositionManager,
            treasury,
            account0,
            account1,
            dca,
            dcaPositionId,
            liquidityPositionId,
            liquidityStrategyId,
            positionManagerUniV3,
            factoryUniV3,
        } = await loadFixture(runStrategy))
    })

    describe('Given an open position with only DCA', () => {
        describe('When the owner of position calls closePosition', () => {
            it('Then the user receives remaining tokens of all DCA positions in a strategy', async () => {
                const strategyTokenBalancesBefore = await _getStrategyBalanceMap(-1n, dcaPositionId)
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await getAccountBalanceMap(strategyTokens, account1)

                await strategyManager.connect(account1).closePosition(dcaPositionId, [])

                const userTokenBalancesAfter = await getAccountBalanceMap(strategyTokens, account1)

                for (const token of strategyTokens) {
                    expect(userTokenBalancesAfter[token]).to.equal(
                        strategyTokenBalancesBefore[token] + userTokenBalancesBefore[token],
                    )
                }
            })

            it('Then position should be marked as closed', async () => {
                await strategyManager.connect(account1).closePosition(dcaPositionId, [])

                const { closed } = await strategyManager.getPosition(account1, dcaPositionId)

                expect(closed).to.be.true
            })
        })
    })

    describe.only('Given an open position with only liquidity', () => {
        describe('When the owner of position calls closePosition', () => {
            it('Then liquidity reward fees are distributed to strategist and treasury', async () => {
                const positionsFees = await LiquidityHelpers.getPositionFeeAmounts(
                    liquidityStrategyId,
                    liquidityPositionId,
                    account1,
                    strategyManager,
                )

                const tokens = new Set(positionsFees.flatMap(fees => fees.tokens))
                const feesByFeeToAndToken = mapPositionsFeesByFeeToAndToken(positionsFees)

                const [
                    treasuryRewardBalancesBefore,
                    strategistRewardBalancesBefore,
                ] = await Promise.all([
                    getAccountRewardsMap(treasury, tokens, strategyManager),
                    getAccountRewardsMap(account0, tokens, strategyManager),
                ])

                await strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )

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

            it('Then the user receives remaining tokens of all liquidity positions in a strategy', async () => {
                const strategyTokenBalancesBefore = await _getStrategyBalanceMap(
                    liquidityStrategyId,
                    liquidityPositionId,
                )
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await getAccountBalanceMap(strategyTokens, account1)

                await strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )

                const userTokenBalancesAfter = await getAccountBalanceMap(strategyTokens, account1)

                for (const token of strategyTokens) {
                    expect(userTokenBalancesAfter[token])
                        .to.equal(strategyTokenBalancesBefore[token] + userTokenBalancesBefore[token])
                }
            })

            it('Then emit Fee events to strategist and treasury', async () => {
                const expectedFeeEvents = await getRewardsDistributionFeeEvents(
                    treasury,
                    account1,
                    account0,
                    liquidityStrategyId,
                    liquidityPositionId,
                    strategyManager,
                )

                const receipt = await (
                    await strategyManager.connect(account1).closePosition(
                        liquidityPositionId,
                        await getLiquidityMinOutputs(liquidityPositionId),
                    )
                ).wait()

                const feeEvents = getAllFeeEventLogs(receipt)

                expect(feeEvents?.length).to.be.greaterThan(0)
                feeEvents?.forEach((event, index) => expect(event.args).to.deep.equal(expectedFeeEvents[index]))
            })

            it('Then the contract emits a PositionClosed event', async () => {
                const liquidityWithdrawnAmounts = await getLiquidityWithdrawnAmounts(liquidityStrategyId, liquidityPositionId)

                const receipt = await (await strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )).wait()

                const positionClosedEvent = getEventLog(receipt, 'PositionClosed', strategyPositionManager.interface)

                expect(positionClosedEvent?.args).to.deep.equal([
                    await unwrapAddressLike(account1),
                    liquidityStrategyId,
                    liquidityPositionId,
                    [],
                    [],
                    liquidityWithdrawnAmounts,
                    [],
                ])
            })

            it('Then position should be marked as closed', async () => {
                await strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )

                const { closed } = await strategyManager.getPosition(
                    account1,
                    liquidityPositionId,
                )

                expect(closed).to.be.true
            })
        })

        describe('When the owner of position calls closePositionIgnoringSlippage', () => {
            it('Then the user receives remaining tokens of all liquidity positions in a strategy', async () => {
                const strategyTokenBalancesBefore = await _getStrategyBalanceMap(liquidityStrategyId, liquidityPositionId)
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await getAccountBalanceMap(strategyTokens, account1)

                await strategyManager.connect(account1).closePositionIgnoringSlippage(liquidityPositionId)

                const userTokenBalancesAfter = await getAccountBalanceMap(strategyTokens, account1)

                for (const token of strategyTokens) {
                    expect(userTokenBalancesAfter[token]).to.equal(
                        strategyTokenBalancesBefore[token] + userTokenBalancesBefore[token],
                    )
                }
            })

            it('Then the contract emits a PositionClosed event', async () => {
                const liquidityWithdrawnAmounts = await getLiquidityWithdrawnAmounts(liquidityStrategyId, liquidityPositionId)

                const receipt = await (
                    await strategyManager
                        .connect(account1)
                        .closePositionIgnoringSlippage(liquidityPositionId)
                ).wait()

                const positionClosedEvent = getEventLog(receipt, 'PositionClosed', strategyPositionManager.interface)

                expect(positionClosedEvent?.args).to.deep.equal([
                    await unwrapAddressLike(account1),
                    liquidityStrategyId,
                    liquidityPositionId,
                    [],
                    [],
                    liquidityWithdrawnAmounts,
                    [],
                ])
            })

            it('Then position should be marked as closed', async () => {
                await strategyManager.connect(account1).closePositionIgnoringSlippage(liquidityPositionId)

                const { closed } = await strategyManager.getPosition(
                    account1,
                    liquidityPositionId,
                )

                expect(closed).to.be.true
            })
        })
    })

    describe('Given a closed position', () => {
        beforeEach(() => strategyManager.connect(account1).closePosition(dcaPositionId, []))

        describe('When the owner of position calls closePosition', () => {
            it('Then the contract reverts with PositionAlreadyClosed', async () => {
                await expectCustomError(
                    strategyManager.connect(account1).closePosition(dcaPositionId, []),
                    'PositionAlreadyClosed',
                )
            })
        })

    })
})
