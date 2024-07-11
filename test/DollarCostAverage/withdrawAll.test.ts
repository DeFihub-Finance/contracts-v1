import { Compare } from '@src/Compare'
import { NetworkService } from '@src/NetworkService'
import { PositionParams } from './fixtures/base.fixture'
import { Signer } from 'ethers'
import { createDepositFixture } from './fixtures/create-deposit.fixture'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { DollarCostAverage, Quoter, TestERC20 } from '@src/typechain'
import { ContractFees } from '@src/ContractFees'
import { UniswapV3 } from '@src/helpers'

// EFFECTS
// => withdraw all tokens of a position
//      => withdraw when there's no swapped tokens
//      => withdraw when there's no unswapped tokens
//      => withdraw when there's both
//      => withdraw when there's neither
//      => withdraw before position finish and discount early withdraw fee
// => position balances should return zero
// => emit WithdrawAll event
//
// SIDE EFFECTS
// => pool.nextSwapAmount
// => position.lastUpdateSwap
// => position.amountPerSwap
// => updates position's outputTokenBalance
// => updates position's inputTokenBalanc
//
// REVERTS
// => if position id is invalid
//
// ATTACKS
// => tries to withdrawAll all twice
describe('DCA#withdrawAll', () => {
    let dca: DollarCostAverage
    let stablecoin: TestERC20
    let weth: TestERC20
    let quoterUniV3: Quoter

    let account0: Signer
    let swapper: Signer

    let userOutputTokenBalanceBefore: bigint
    let userInputTokenBalanceBefore: bigint

    let positionParams: PositionParams

    let POOL_FEE: bigint
    let TWENTY_FOUR_HOURS_IN_SECONDS: number

    const tokenOutBalance = async () => weth.balanceOf(account0)
    const tokenInBalance = async () => stablecoin.balanceOf(account0)

    beforeEach(async () => {
        ({
            dca,
            stablecoin,
            weth,
            account0,
            swapper,
            positionParams,
            quoterUniV3,
            POOL_FEE,
            TWENTY_FOUR_HOURS_IN_SECONDS,
        } = await loadFixture(createDepositFixture))

        userInputTokenBalanceBefore = await tokenInBalance()
        userOutputTokenBalanceBefore = await tokenOutBalance()
    })

    describe('EFFECTS', () => {
        it('withdraws all tokens when no swap was executed', async () => {
            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const userOutputTokenBalanceDelta = (await tokenOutBalance()) - userOutputTokenBalanceBefore
            const userInputTokenBalanceDelta = (await tokenInBalance()) - userInputTokenBalanceBefore
            const withdrawnInputTokenAmount = ContractFees.discountNonSubscriberFee(positionParams.depositAmount)

            expect(userInputTokenBalanceDelta).to.be.deep.equals(withdrawnInputTokenAmount)
            expect(userOutputTokenBalanceDelta).to.be.deep.equals(0n)
        })

        it('withdraws all tokens when position is halfway through', async () => {
            const expectedAmountOut = await UniswapV3.getOutputTokenAmount(
                quoterUniV3,
                stablecoin,
                weth,
                POOL_FEE,
                positionParams.depositAmount / 2n,
            )
            const expectedUserOutputTokenBalance = ContractFees.discountNonSubscriberFee(expectedAmountOut)
            const swapsToExecute = positionParams.swaps / 2n

            for (let i = 0; i < swapsToExecute; i++) {
                await dca.connect(swapper).swap([
                    {
                        poolId: positionParams.poolId,
                        minOutputAmount: 0,
                    },
                ])
                await NetworkService.fastForwardChain(TWENTY_FOUR_HOURS_IN_SECONDS)
            }

            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const userOutputTokenBalanceDelta = (await tokenOutBalance()) - userOutputTokenBalanceBefore
            const userInputTokenBalanceDelta = (await tokenInBalance()) - userInputTokenBalanceBefore
            const remaningInputTokensAfterSwaps = positionParams.depositAmount - (
                positionParams.depositAmount / positionParams.swaps * swapsToExecute
            )
            const withdrawnInputTokenAmount = ContractFees.discountNonSubscriberFee(remaningInputTokensAfterSwaps)

            expect(userInputTokenBalanceDelta).to.be.deep.equals(withdrawnInputTokenAmount)
            Compare.almostEqual({
                target: expectedUserOutputTokenBalance,
                value: userOutputTokenBalanceDelta,
                tolerance: 10n ** 16n, // Tolerance of 0.01
            })
        })

        it('withdraws all tokens when position finishes', async () => {
            const expectedAmountOut = await UniswapV3.getOutputTokenAmount(
                quoterUniV3,
                stablecoin,
                weth,
                POOL_FEE,
                positionParams.depositAmount,
            )
            const expectedUserOutputTokenBalance = ContractFees.discountNonSubscriberFee(expectedAmountOut)

            for (let i = 0; i < positionParams.swaps; i++) {
                await dca.connect(swapper).swap([
                    {
                        poolId: positionParams.poolId,
                        minOutputAmount: 0,
                    },
                ])
                await NetworkService.fastForwardChain(TWENTY_FOUR_HOURS_IN_SECONDS)
            }

            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const userOutputTokenBalanceDelta = (await tokenOutBalance()) - userOutputTokenBalanceBefore
            const userInputTokenBalanceDelta = (await tokenInBalance()) - userInputTokenBalanceBefore

            expect(userInputTokenBalanceDelta).to.be.deep.equals(0n)

            Compare.almostEqual({
                target: expectedUserOutputTokenBalance,
                value: userOutputTokenBalanceDelta,
                tolerance: 10n ** 16n, // Tolerance of 0.1
            })
        })

        it('emits WithdrawSwapped event after user withdraw swapped tokens', async () => {
            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            const { outputTokenBalance } = await dca.getPositionBalances(
                account0,
                positionParams.positionId,
            )

            const tx = dca.connect(account0).withdrawSwapped(positionParams.positionId)

            await expect(tx).to.emit(dca, 'WithdrawSwapped').withArgs(
                await account0.getAddress(),
                positionParams.poolId,
                positionParams.positionId,
                outputTokenBalance,
            )
        })

        it('returns zero for positions input and output token balance', async () => {
            for (let i = 0; i <= positionParams.swaps / 2n - 1n; i++) {
                await dca.connect(swapper).swap([
                    {
                        poolId: positionParams.poolId,
                        minOutputAmount: 0,
                    },
                ])
                await NetworkService.fastForwardChain(TWENTY_FOUR_HOURS_IN_SECONDS)
            }

            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const positionId = 0
            const {
                inputTokenBalance,
                outputTokenBalance,
            } = await dca.getPositionBalances(
                account0,
                positionId,
            )

            expect(inputTokenBalance).to.be.deep.equals(0n)
            expect(outputTokenBalance).to.be.deep.equals(0n)
        })

        it('emits WithdrawAll event after user withdraw all assets', async () => {
            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            const {
                inputTokenBalance,
                outputTokenBalance,
            } = await dca.getPositionBalances(
                account0,
                positionParams.positionId,
            )

            const tx = dca.connect(account0).withdrawAll(positionParams.positionId)

            await expect(tx).to.emit(dca, 'WithdrawAll').withArgs(
                await account0.getAddress(),
                positionParams.poolId,
                positionParams.positionId,
                inputTokenBalance,
                outputTokenBalance,
            )
        })

    })

    describe('SIDE EFFECTS', () => {
        it('updates pools nextSwapAmount', async () => {
            const nextSwapAmount = async () => (await dca.getPool(positionParams.poolId)).nextSwapAmount
            const nextSwapAmountBefore = await nextSwapAmount()

            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const nextSwapAmountDelta = (await nextSwapAmount()) - nextSwapAmountBefore
            const expectedSwapDelta = positionParams.depositAmount / positionParams.swaps * -1n

            expect(nextSwapAmountDelta).to.be.deep.equals(ContractFees.discountNonSubscriberFee(expectedSwapDelta))
        })

        it('updates positions lastUpdateSwap', async () => {
            const lastUpdateSwap = async () => (await dca.getPosition(
                account0,
                positionParams.poolId,
            )).lastUpdateSwap
            const lastUpdateSwapBefore = await lastUpdateSwap()

            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const lastUpdateSwapDelta = await lastUpdateSwap() - lastUpdateSwapBefore

            expect(lastUpdateSwapDelta).to.be.deep.equals(0n)
        })

        it('updates amountPerSwap to zero', async () => {
            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const amountPerSwap = (await dca.getPosition(
                await account0.getAddress(),
                positionParams.poolId,
            )).lastUpdateSwap

            expect(amountPerSwap).to.be.deep.equals(0n)
        })
    })

    describe('REVERTS', () => {
        it('if positionId is invalid', async () => {
            const invalidPoolId = 1
            const tx = dca.withdrawAll(invalidPoolId)

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPositionId')
        })
    })

    describe('ATTACKS', () => {
        it('tries to withdrawAll all twice', async () => {
            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const account0Address = await account0.getAddress()

            const tokenInBalanceBefore = await stablecoin.balanceOf(account0Address)
            const tokenOutBalanceBefore = await weth.balanceOf(account0Address)

            await dca.connect(account0).withdrawAll(positionParams.poolId)

            const tokenInBalanceAfter = await stablecoin.balanceOf(account0Address)
            const tokenOutBalanceAfter = await weth.balanceOf(account0Address)

            expect(tokenInBalanceBefore).to.be.deep.equal(tokenInBalanceAfter)
            expect(tokenOutBalanceBefore).to.be.deep.equal(tokenOutBalanceAfter)
        })
    })
})
