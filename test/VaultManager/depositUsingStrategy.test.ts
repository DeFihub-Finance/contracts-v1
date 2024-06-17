import { expect } from 'chai'
import { Signer, parseEther } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { StrategyManager, TestERC20, TestVault, VaultManager } from '@src/typechain'
import { NetworkService } from '@src/NetworkService'
import { baseVaultManagerFixture } from './fixtures/base.fixture'

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
    let treasury: Signer
    let vaultManager: VaultManager
    let vault: TestVault
    let token: TestERC20
    let strategyManager: StrategyManager

    const amountToDeposit = parseEther('10')

    beforeEach(async () => {
        ({ account0, treasury, vaultManager, vault, strategyManager, token } =
            await loadFixture(baseVaultManagerFixture))
    })

    describe('given a strategy contract', () => {
        let strategyManagerSigner: Signer

        beforeEach(async () => {
            strategyManagerSigner = await NetworkService.impersonate(
                await strategyManager.getAddress(),
            )

            token.mint(await strategyManager.getAddress(), amountToDeposit)

            await token
                .connect(strategyManagerSigner)
                .approve(await vaultManager.getAddress(), amountToDeposit)
        })

        describe('when investUsingStrategy is called', () => {
            it('then vault tokens are transferred to strategy manger NOT discounting the base fee', async () => {
                await vaultManager
                    .connect(strategyManagerSigner)
                    .investUsingStrategy(
                        await vault.getAddress(),
                        amountToDeposit,
                    )

                expect(
                    await vault.balanceOf(await strategyManager.getAddress()),
                ).to.eq(amountToDeposit)
            })

            it('then deposit fees are NOT sent to the treasury', async () => {
                const treasuryBalanceBefore = await token.balanceOf(
                    await treasury.getAddress(),
                )

                await vaultManager
                    .connect(strategyManagerSigner)
                    .investUsingStrategy(
                        await vault.getAddress(),
                        amountToDeposit,
                    )

                const treasuryBalanceDelta =
                    (await token.balanceOf(await treasury.getAddress())) -
                    treasuryBalanceBefore

                expect(treasuryBalanceDelta).to.eq(0)
            })

            it('then want tokens are deducted from strategyManager', async () => {
                const strategyManagerBalanceBefore = await token.balanceOf(
                    await strategyManager.getAddress(),
                )

                await vaultManager
                    .connect(strategyManagerSigner)
                    .investUsingStrategy(
                        await vault.getAddress(),
                        amountToDeposit,
                    )

                const strategyManagerBalanceDelta =
                    (await token.balanceOf(
                        await strategyManager.getAddress(),
                    )) - strategyManagerBalanceBefore

                expect(strategyManagerBalanceDelta).to.eq(-amountToDeposit)
            })

            it('then Deposit event is emitted', async () => {
                await expect(
                    vaultManager
                        .connect(strategyManagerSigner)
                        .investUsingStrategy(
                            await vault.getAddress(),
                            amountToDeposit,
                        ),
                )
                    .to.emit(vaultManager, 'PositionCreated')
                    .withArgs(
                        await vault.getAddress(),
                        await strategyManager.getAddress(),
                        amountToDeposit,
                    )
            })

            it('then Fee event is NOT emitted', async () => {
                await expect(
                    vaultManager
                        .connect(strategyManagerSigner)
                        .investUsingStrategy(
                            await vault.getAddress(),
                            amountToDeposit,
                        ),
                ).to.not.emit(vaultManager, 'Fee')
            })
        })
    })

    describe('given a non-strategy account', () => {
        describe('when investUsingStrategy is called', () => {
            it('then transaction reverts with Unauthorized', async () => {
                await expect(
                    vaultManager
                        .connect(account0)
                        .investUsingStrategy(
                            await vault.getAddress(),
                            amountToDeposit,
                        ),
                ).to.be.revertedWithCustomError(vaultManager, 'Unauthorized')
            })
        })
    })
})
