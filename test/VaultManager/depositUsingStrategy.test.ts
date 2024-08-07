import { expect } from 'chai'
import { Signer, parseEther, ContractTransactionResponse } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { StrategyManager, SubscriptionManager, TestERC20, TestVault, VaultManager } from '@src/typechain'
import { baseVaultManagerFixture } from './fixtures/base.fixture'
import { Fees } from '@src/helpers/Fees'
import { createStrategy } from '@src/helpers'

// given a strategy contract
//      when investUsingStrategy is called
//          then vault tokens are transferred to strategy manger NOT discounting the base fee
//          then deposit fees are NOT sent to the treasury
//          then want tokens are deducted from strategyManager
//          then Deposit event is emitted
//          then Fee event is NOT emitted
// given a non-strategy account
//      when investUsingStrategy is called
//          then transaction reverts with Unauthorized
describe('VaultManager#investUsingStrategy', () => {
    let account0: Signer
    let vaultManager: VaultManager
    let vault: TestVault
    let stablecoin: TestERC20
    let strategyManager: StrategyManager
    let strategyId: bigint
    let permitAccount0: SubscriptionManager.PermitStruct

    const amountToDeposit = parseEther('10')

    beforeEach(async () => {
        ({
            account0,
            vaultManager,
            vault,
            strategyManager,
            stablecoin,
            permitAccount0,
        } = await loadFixture(baseVaultManagerFixture))
    })

    describe('given a strategy contract', () => {
        beforeEach(async () => {
            strategyId = await createStrategy(
                account0,
                permitAccount0,
                strategyManager,
                {
                    dcaInvestments: [],
                    vaultInvestments: [
                        {
                            vault,
                            percentage: 100,
                        },
                    ],
                    liquidityInvestments: [],
                    tokenInvestments: [],
                },
            )

            await stablecoin.connect(account0).approve(strategyManager, amountToDeposit)
        })

        describe('when investUsingStrategy is called', () => {
            let tx: ContractTransactionResponse

            beforeEach(async () => {
                tx = await strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amountToDeposit,
                        inputTokenSwap: '0x',
                        dcaSwaps: [],
                        vaultSwaps: ['0x'],
                        tokenSwaps: [],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    })
            })

            it('Deposit event is emitted', async () => {
                await expect(tx)
                    .to
                    .emit(vaultManager, 'PositionCreated')
                    .withArgs(
                        await strategyManager.getAddress(),
                        await vault.getAddress(),
                        Fees.deductProductFee(
                            amountToDeposit,
                            true,
                            vaultManager,
                        ),
                    )
            })

            it('Fee event is NOT emitted', async () => {
                await expect(tx).to.not.emit(vaultManager, 'Fee')
            })
        })
    })

    describe('given a non-strategy account', () => {
        describe('when investUsingStrategy is called', () => {
            it('then transaction reverts with Unauthorized', async () => {
                await expect(
                    vaultManager
                        .connect(account0)
                        .investUsingStrategy(vault, amountToDeposit),
                ).to.be.revertedWithCustomError(vaultManager, 'Unauthorized')
            })
        })
    })
})
