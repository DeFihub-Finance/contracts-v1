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
// => withdraw swapped tokens of a position
//      => withdraw when there's no swapped tokens
//      => withdraw when there's no unswapped tokens
// => position balances should return zero for swapped
// => emit WithdrawSwapped event
//
// SIDE EFFECTS
// => position.lastUpdateSwap
//
// REVERTS
// => if position id is invalid
//
// ATTACKS
// => tries to withdraw swapped twice
describe('DCA#withdrawSwapped', () => {
    let account0: Signer
    let swapper: Signer
    let dca: DollarCostAverage
    let tokenIn: TestERC20
    let tokenOut: TestERC20
    let userOutputTokenBalanceBefore: bigint
    let positionParams: PositionParams
    let quoterUniV3: Quoter

    let POOL_FEE: bigint
    let TWENTY_FOUR_HOURS_IN_SECONDS: number

    const tokenOutBalance = async () => tokenOut.balanceOf(await account0.getAddress())

    beforeEach(async () => {
        ({
            dca,
            account0,
            swapper,
            tokenOut,
            positionParams,
            quoterUniV3,
            tokenIn,
            tokenOut,
            POOL_FEE,
            TWENTY_FOUR_HOURS_IN_SECONDS,
        } = await loadFixture(createDepositFixture))

        userOutputTokenBalanceBefore = await tokenOutBalance()
    })

    describe('EFFECTS', () => {
        it('withdraws swapped okens when no swap was executed', async () => {
            await dca.connect(account0).withdrawSwapped(positionParams.poolId)

            const userOutputTokenBalanceDelta = (await tokenOutBalance()) - userOutputTokenBalanceBefore

            expect(userOutputTokenBalanceDelta).to.be.equal(0n)
        })

        it('withdraws swapped tokens when position is halfway through', async () => {
            const expectedAmountOut = await UniswapV3.getOutputTokenAmount(
                quoterUniV3,
                tokenIn,
                tokenOut,
                POOL_FEE,
                positionParams.depositAmount / 2n,
            )
            const expectedUserOutputTokenBalance = ContractFees.discountBaseFee(expectedAmountOut)

            for (let i = 0; i <= positionParams.swaps / 2n - 1n; i++) {
                await dca.connect(swapper).swap([
                    {
                        poolId: positionParams.poolId,
                        minOutputAmount: 0,
                    },
                ])

                await NetworkService.fastForwardChain(TWENTY_FOUR_HOURS_IN_SECONDS)
            }

            await dca.connect(account0).withdrawSwapped(positionParams.poolId)

            const userOutputTokenBalanceDelta = (await tokenOutBalance()) - userOutputTokenBalanceBefore

            Compare.almostEqual({
                target: expectedUserOutputTokenBalance,
                value: userOutputTokenBalanceDelta,
                tolerance: 10n * 4n, // Tolerance of 0.0001 for 8 decimals
            })
        })

        it('withdraws swapped tokens when position finishes', async () => {
            const expectedAmountOut = await UniswapV3.getOutputTokenAmount(
                quoterUniV3,
                tokenIn,
                tokenOut,
                POOL_FEE,
                positionParams.depositAmount,
            )
            const expectedUserOutputTokenBalance = ContractFees.discountBaseFee(expectedAmountOut)

            for (let i = 0; i < positionParams.swaps; i++) {
                await dca.connect(swapper).swap([
                    {
                        poolId: positionParams.poolId,
                        minOutputAmount: 0,
                    },
                ])
                await NetworkService.fastForwardChain(TWENTY_FOUR_HOURS_IN_SECONDS)
            }

            await dca.connect(account0).withdrawSwapped(positionParams.poolId)

            const userOutputTokenBalanceDelta = (await tokenOutBalance()) - userOutputTokenBalanceBefore

            Compare.almostEqual({
                target: expectedUserOutputTokenBalance,
                value: userOutputTokenBalanceDelta,
                tolerance: 10n * 4n, // Tolerance of 0.0001 for 8 decimals
            })
        })

        it('returns zero for positions output token balance', async () => {
            await dca.connect(account0).withdrawSwapped(positionParams.poolId)

            const {
                outputTokenBalance,
            } = await dca.getPositionBalances(
                await account0.getAddress(),
                positionParams.positionId,
            )

            expect(outputTokenBalance).to.be.equals(0n)
        })
    })

    describe('SIDE EFFECTS', () => {
        it('updates positions lastUpdateSwap', async () => {
            const lastUpdateSwap = async () => (await dca.getPosition(await account0.getAddress(), positionParams.poolId)).lastUpdateSwap
            const lastUpdateSwapBefore = await lastUpdateSwap()

            await dca.connect(account0).withdrawSwapped(positionParams.poolId)

            const lastUpdateSwapDelta = await lastUpdateSwap() - lastUpdateSwapBefore

            expect(lastUpdateSwapDelta).to.be.equals(0n)
        })
    })

    describe('REVERTS', () => {
        it('if positionId is invalid', async () => {
            const invalidPoolId = 1
            const tx = dca.withdrawSwapped(invalidPoolId)

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPositionId')
        })
    })

    describe('ATTACKS', () => {
        it('tries to withdraw swapped twice', async () => {
            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])
            await dca.connect(account0).withdrawSwapped(positionParams.positionId)

            const userOutputTokenBalanceBefore = await tokenOutBalance()

            await dca.connect(account0).withdrawSwapped(positionParams.positionId)

            const  userOutputTokenBalanceDelta = (await tokenOutBalance()) - userOutputTokenBalanceBefore

            expect(userOutputTokenBalanceDelta).to.be.equals(0n)
        })
    })
})
