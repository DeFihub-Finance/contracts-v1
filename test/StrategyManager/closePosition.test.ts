import { expect } from 'chai'
import { UniswapV3, unwrapAddressLike } from '@defihub/shared'
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
} from '@src/helpers'

// => Given an open position
//      => When the owner of position calls closePosition
//          => Then the user receives remaining tokens of all positions in a strategy
//          => Then the contract emits a PositionClosed event
//          => Then position should be marked as closed
//      => When the owner of position calls closePositionIgnoringSlippage
//          => Then the user receives remaining tokens of all positions in a strategy
//          => Then the contract emits a PositionClosed event
//          => Then position should be marked as closed
//
// => Given a closed position
//     => When the owner of position calls closePosition
//          => Then the contract reverts with PositionAlreadyClosed
describe('StrategyManager#closePosition', () => {
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

    describe('Given an open position with only liquidity', () => {
        describe('When the owner of position calls closePosition', () => {
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
