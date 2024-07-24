import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    IBeefyVaultV7__factory,
    StrategyManager,
    TestERC20__factory,
    UniswapPositionManager,
    UniswapV3Factory,
} from '@src/typechain'
import { Signer } from 'ethers'
import { runStrategy } from './fixtures/run-strategy.fixture'
import { ethers } from 'hardhat'
import { UniswapV3 } from '@src/helpers'
import { InvestLib } from '@src/typechain/artifacts/contracts/StrategyManager'

// => Given an open position
//      => When the owner of position calls closePosition
//          => Then the user receives remaning tokens of all positions in a strategy
//          => Then the contract emits a PositionClosed event
//          => Then position should be marked as closed
//
// => Given a closed position
//     => When the owner of position calls closePosition
//          => Then the contract reverts with PositionAlreadyClosed
describe('StrategyManager#closePosition', () => {
    let account1: Signer
    let dca: DollarCostAverage
    let strategyManager: StrategyManager

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
            ]= await Promise.all([
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
            } = await getLiquidityPositionInfo(liquidityPosition)

            addOrCreateBalance(token0, amount0 + fees.amount0)
            addOrCreateBalance(token1, amount1 + fees.amount1)
        }

        return positionTokenBalances
    }

    async function snapshotTokenBalances(tokens: Set<string>, account: string) {
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
                await UniswapV3.getPoolByFactoryContract(
                    factoryUniV3,
                    position.token0,
                    position.token1,
                    position.fee,
                ),
                position,
            )
        }))
    }

    async function getLiquidityPositionInfo(
        { tokenId }: InvestLib.LiquidityPositionStructOutput,
    ) {
        const [
            position,
            fees,
        ] = await Promise.all([
            positionManagerUniV3.positions(tokenId),
            UniswapV3.getPositionFees(
                tokenId,
                positionManagerUniV3,
                account1,
                strategyManager,
            ),
        ])

        const { token0, token1, fee } = position
        const { amount0, amount1 } = UniswapV3.getPositionTokenAmounts(
            await UniswapV3.getPoolByFactoryContract(factoryUniV3, token0, token1, fee),
            position,
        )

        return {
            token0,
            token1,
            amount0,
            amount1,
            fees,
        }
    }

    async function getLiquidityWithdrawnAmounts(strategyPositionId: bigint) {
        const { liquidityPositions } = await strategyManager.getPositionInvestments(account1, strategyPositionId)

        return Promise.all(liquidityPositions.map(async position => {
            const {
                amount0,
                amount1,
                fees,
            } = await getLiquidityPositionInfo(position)

            return [amount0 + fees.amount0, amount1 + fees.amount1]
        }))
    }

    beforeEach(async () => {
        ({
            strategyManager,
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
            it('Then the user receives remaning tokens of all DCA positions in a strategy', async () => {
                const account1Address = await account1.getAddress()

                const strategyTokenBalancesBefore = await snapshotStrategyTokenBalances(dcaPositionId)
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await snapshotTokenBalances(strategyTokens, account1Address)

                await strategyManager.connect(account1).closePosition(dcaPositionId, [])

                const userTokenBalancesAfter = await snapshotTokenBalances(strategyTokens, account1Address)

                for (const token of strategyTokens) {
                    expect(userTokenBalancesAfter[token]).to.equal(
                        strategyTokenBalancesBefore[token] + userTokenBalancesBefore[token],
                    )
                }
            })

            it('Then position should be marked as closed', async () => {
                const account1Address = await account1.getAddress()

                await strategyManager.connect(account1).closePosition(dcaPositionId, [])

                const { closed } = await strategyManager.getPosition(
                    account1Address,
                    dcaPositionId,
                )

                expect(closed).to.be.true
            })
        })
    })

    describe('Given an open position with only liquidity', () => {
        describe('When the owner of position calls closePosition', () => {
            it('Then the user receives remaning tokens of all liquidity positions in a strategy', async () => {
                const account1Address = await account1.getAddress()

                const strategyTokenBalancesBefore = await snapshotStrategyTokenBalances(liquidityPositionId)
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await snapshotTokenBalances(strategyTokens, account1Address)

                await strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )

                const userTokenBalancesAfter = await snapshotTokenBalances(strategyTokens, account1Address)

                for (const token of strategyTokens) {
                    expect(userTokenBalancesAfter[token]).to.equal(
                        strategyTokenBalancesBefore[token] + userTokenBalancesBefore[token],
                    )
                }
            })

            it('Then the contract emits a PositionClosed event', async () => {
                const liquidityWithdrawnAmounts = await getLiquidityWithdrawnAmounts(liquidityPositionId)

                const tx = strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )

                await expect(tx)
                    .to.emit(strategyManager, 'PositionClosed')
                    .withArgs(
                        await account1.getAddress(),
                        liquidityStrategyId,
                        liquidityPositionId,
                        [],
                        [],
                        liquidityWithdrawnAmounts,
                        [],
                    )
            })

            it('Then position should be marked as closed', async () => {
                const account1Address = await account1.getAddress()

                await strategyManager.connect(account1).closePosition(
                    liquidityPositionId,
                    await getLiquidityMinOutputs(liquidityPositionId),
                )

                const { closed } = await strategyManager.getPosition(
                    account1Address,
                    liquidityPositionId,
                )

                expect(closed).to.be.true
            })
        })
    })

    describe('Given a closed position', () => {
        beforeEach(async () => {
            await strategyManager.connect(account1).closePosition(dcaPositionId, [])
        })

        describe('When the owner of position calls closePosition', () => {
            it('Then the contract reverts with PositionAlreadyClosed', async () => {
                await expect(strategyManager.connect(account1).closePosition(dcaPositionId, []))
                    .to.be.revertedWithCustomError(strategyManager, 'PositionAlreadyClosed')
            })
        })

    })
})
