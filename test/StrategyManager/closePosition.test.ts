import { expect } from 'chai'
import { ethers } from 'hardhat'
import { UniswapV3, unwrapAddressLike } from '@defihub/shared'
import { AddressLike, Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    IBeefyVaultV7__factory,
    StrategyManager__v2,
    StrategyPositionManager,
    TestERC20__factory,
    UniswapPositionManager,
    UniswapV3Factory,
} from '@src/typechain'
import { runStrategy } from './fixtures/run-strategy.fixture'
import {
    expectCustomError,
    getEventLog,
    LiquidityHelpers,
    UniswapV3 as UniswapV3Helpers,
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
    let strategyManager: StrategyManager__v2
    let strategyPositionManager: StrategyPositionManager

    let dcaPositionId: bigint

    let liquidityPositionId: bigint
    let liquidityStrategyId: bigint

    let positionManagerUniV3: UniswapPositionManager
    let factoryUniV3: UniswapV3Factory

    async function snapshotStrategyTokenBalances(strategyPositionId: bigint) {
        const positionTokenBalances: Record<string, bigint> = {}

        const {
            dcaPositions,
            vaultPositions,
            liquidityPositions,
        } = await strategyManager.getPositionInvestments(
            account1,
            strategyPositionId,
        )

        function addOrCreateBalance(token: string, balance: bigint) {
            if (positionTokenBalances[token])
                positionTokenBalances[token] = balance + positionTokenBalances[token]
            else
                positionTokenBalances[token] = balance
        }

        for (const positionId of dcaPositions) {
            const [
                { inputTokenBalance, outputTokenBalance },
                { poolId },
            ] = await Promise.all([
                dca.getPositionBalances(strategyManager, positionId),
                dca.getPosition(strategyManager, positionId),
            ])

            const { inputToken, outputToken } = await dca.getPool(poolId)

            addOrCreateBalance(inputToken, inputTokenBalance)
            addOrCreateBalance(outputToken, outputTokenBalance)
        }

        // In the case of TestVault, users doesn't get any yield, it simply receives
        // the same amount of tokens as deposited. This serves only to test the
        // interaction between StrategyManager and the Vaults, not the vault rewards itself.
        // That's the reason why the amount of shares is being considered as the amount of want
        // to be received after position is close.
        for (const vaultPosition of vaultPositions) {
            const { vault, amount } = vaultPosition

            const wantToken = await IBeefyVaultV7__factory.connect(vault, ethers.provider).want()

            addOrCreateBalance(wantToken, amount)
        }

        for (const liquidityPosition of liquidityPositions) {
            const {
                fees,
                amount0,
                amount1,
                token0,
                token1,
            } = await LiquidityHelpers.getLiquidityPositionInfo(
                liquidityPosition.tokenId,
                positionManagerUniV3,
                factoryUniV3,
                strategyManager,
            )

            addOrCreateBalance(token0, amount0 + fees.amount0)
            addOrCreateBalance(token1, amount1 + fees.amount1)
        }

        return positionTokenBalances
    }

    async function snapshotTokenBalances(tokens: Set<string>, account: AddressLike) {
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

    async function getLiquidityWithdrawnAmounts(strategyPositionId: bigint) {
        const { liquidityPositions } = await strategyManager.getPositionInvestments(account1, strategyPositionId)

        return Promise.all(liquidityPositions.map(async position => {
            const {
                amount0,
                amount1,
                fees,
            } = await LiquidityHelpers.getLiquidityPositionInfo(
                position.tokenId,
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
                const strategyTokenBalancesBefore = await snapshotStrategyTokenBalances(dcaPositionId)
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await snapshotTokenBalances(strategyTokens, account1)

                await strategyManager.connect(account1).closePosition(dcaPositionId, [])

                const userTokenBalancesAfter = await snapshotTokenBalances(strategyTokens, account1)

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
                const strategyTokenBalancesBefore = await snapshotStrategyTokenBalances(liquidityPositionId)
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await snapshotTokenBalances(strategyTokens, account1)

                await strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )

                const userTokenBalancesAfter = await snapshotTokenBalances(strategyTokens, account1)

                for (const token of strategyTokens) {
                    expect(userTokenBalancesAfter[token]).to.equal(
                        strategyTokenBalancesBefore[token] + userTokenBalancesBefore[token],
                    )
                }
            })

            it('Then the contract emits a PositionClosed event', async () => {
                const liquidityWithdrawnAmounts = await getLiquidityWithdrawnAmounts(liquidityPositionId)

                const receipt = await (await strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )).wait()

                const feeEvent = getEventLog(receipt, 'PositionClosed', strategyPositionManager.interface)

                expect(feeEvent?.args).to.deep.equal([
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
                const strategyTokenBalancesBefore = await snapshotStrategyTokenBalances(liquidityPositionId)
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await snapshotTokenBalances(strategyTokens, account1)

                await strategyManager.connect(account1).closePositionIgnoringSlippage(liquidityPositionId)

                const userTokenBalancesAfter = await snapshotTokenBalances(strategyTokens, account1)

                for (const token of strategyTokens) {
                    expect(userTokenBalancesAfter[token]).to.equal(
                        strategyTokenBalancesBefore[token] + userTokenBalancesBefore[token],
                    )
                }
            })

            it('Then the contract emits a PositionClosed event', async () => {
                const liquidityWithdrawnAmounts = await getLiquidityWithdrawnAmounts(liquidityPositionId)

                const receipt = await (
                    await strategyManager
                        .connect(account1)
                        .closePositionIgnoringSlippage(liquidityPositionId)
                ).wait()

                const feeEvent = getEventLog(receipt, 'PositionClosed', strategyPositionManager.interface)

                expect(feeEvent?.args).to.deep.equal([
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
