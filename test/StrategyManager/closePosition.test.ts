import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    IBeefyVaultV7__factory,
    StrategyManager,
    TestERC20__factory,
} from '@src/typechain'
import { Signer } from 'ethers'
import { runStrategy } from './fixtures/run-strategy.fixture'
import { ethers } from 'hardhat'

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
    const strategyPositionId = 0n

    let strategyManager: StrategyManager
    let account1: Signer
    let dca: DollarCostAverage

    async function snapshotStrategyTokenBalances() {
        const positionTokenBalances: Record<string, bigint> = {}

        const { dcaPositionIds, vaultPositions } = await strategyManager.getPosition(
            await account1.getAddress(),
            strategyPositionId,
        )

        function addOrCreateBalance(token: string, balance: bigint) {
            if (positionTokenBalances[token])
                positionTokenBalances[token] = balance + positionTokenBalances[token]
            else
                positionTokenBalances[token] = balance
        }

        for (const positionId of dcaPositionIds) {
            const strategyManagerAddress = await strategyManager.getAddress()

            const [{ inputTokenBalance, outputTokenBalance }, { poolId }]= await Promise.all([
                dca.getPositionBalances(strategyManagerAddress, positionId),
                dca.getPosition(strategyManagerAddress, positionId),
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

    beforeEach(async () => {
        ({
            strategyManager,
            account1,
            dca,
        } = await loadFixture(runStrategy))
    })

    describe('Given an open position', () => {
        describe('When the owner of position calls closePosition', () => {
            it('Then the user receives remaning tokens of all DCA positions in a strategy', async () => {
                const account1Address = await account1.getAddress()
                const strategyTokenBalancesBefore = await snapshotStrategyTokenBalances()
                const strategyTokens = new Set(Object.keys(strategyTokenBalancesBefore))
                const userTokenBalancesBefore = await snapshotTokenBalances(strategyTokens, account1Address)

                await strategyManager.connect(account1).closePosition(strategyPositionId)

                const userTokenBalancesAfter = await snapshotTokenBalances(strategyTokens, account1Address)

                for (const token of strategyTokens) {
                    expect(userTokenBalancesAfter[token]).to.equal(
                        strategyTokenBalancesBefore[token] + userTokenBalancesBefore[token],
                    )
                }
            })

            it('Then the contract emits a PositionClosed event', async () => {
                await expect(strategyManager.connect(account1).closePosition(strategyPositionId))
                    .to.emit(strategyManager, 'PositionClosed')
            })

            it('Then position should be marked as closed', async () => {
                const account1Address = await account1.getAddress()

                await strategyManager.connect(account1).closePosition(strategyPositionId)

                const { closed } = await strategyManager.getPosition(
                    account1Address,
                    strategyPositionId,
                )

                expect(closed).to.be.true
            })
        })
    })

    describe('Given a closed position', () => {
        beforeEach(async () => {
            await strategyManager.connect(account1).closePosition(strategyPositionId)
        })

        describe('When the owner of position calls closePosition', () => {
            it('Then the contract reverts with PositionAlreadyClosed', async () => {
                await expect(strategyManager.connect(account1).closePosition(strategyPositionId))
                    .to.be.revertedWithCustomError(strategyManager, 'PositionAlreadyClosed')
            })
        })

    })
})
