import { NetworkService } from '@src/NetworkService'
import { PositionParams } from './fixtures/base.fixture'
import { Signer } from 'ethers'
import { createDepositFixture } from './fixtures/create-deposit.fixture'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { DollarCostAverage, Quoter, TestERC20 } from '@src/typechain'
import { UniswapV3 } from '@src/helpers'

// EFFECTS
// => given a pool and a minAmount, execute a swap for that pool
// => treasury receives 1% of the output token amount
//
// SIDE EFFECTS
// => pool.performedSwaps
// => pool.nextSwapAmount
// => pool.lastSwapTimestamp
// => accruedSwapQuoteByPool => internal, should be tested in the used context
//
// REVERTS
// => if someone other than the owner to execute the swap
// => if swap occur before the estimated pool gap
// => if swap occur when there's no tokens to be traded
// => if poolId doesn't exist
describe('DCA#swap', () => {
    let stablecoin: TestERC20
    let weth: TestERC20
    let POOL_FEE: bigint

    let dca: DollarCostAverage
    let account1: Signer
    let swapper: Signer
    let positionParams: PositionParams
    let quoterUniV3: Quoter

    let expectedSwapAmountOut: bigint
    let dcaOutputTokenBalanceBefore: bigint

    let TWENTY_FOUR_HOURS_IN_SECONDS: number

    beforeEach(async () => {
        ({
            dca,
            account1,
            stablecoin,
            weth,
            swapper,
            positionParams,
            quoterUniV3,
            TWENTY_FOUR_HOURS_IN_SECONDS,
            POOL_FEE,
        } = await loadFixture(createDepositFixture))

        dcaOutputTokenBalanceBefore = await weth.balanceOf(await dca.getAddress())

        expectedSwapAmountOut = await UniswapV3.getOutputTokenAmount(
            quoterUniV3,
            stablecoin,
            weth,
            POOL_FEE,
            positionParams.depositAmount / positionParams.swaps,
        )
    })

    describe('EFFECTS', () => {
        it('executes swap for a single pool', async () => {
            const expectedMinAmountOut = expectedSwapAmountOut
                - (expectedSwapAmountOut / 100n) // 1% slippage

            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: expectedMinAmountOut,
                },
            ])

            const dcaOutputTokenBalanceDelta = (await weth.balanceOf(dca)) - dcaOutputTokenBalanceBefore

            expect(dcaOutputTokenBalanceDelta).to.be.gte(expectedMinAmountOut)
        })
    })

    describe('SIDE EFFECTS', () => {
        it('updates performedSwaps', async () => {
            const performedSwaps = async () =>(await dca.getPool(positionParams.poolId)).performedSwaps
            const performedSwapsBefore = await performedSwaps()

            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            const performedSwapsDelta = (await performedSwaps()) - performedSwapsBefore

            expect(performedSwapsDelta).to.be.equals(performedSwapsBefore + 1n)
        })

        it('updates lastSwapTimestamp', async () => {
            const lastSwapTimestamp = async () =>(await dca.getPool(positionParams.poolId)).lastSwapTimestamp
            const lastSwapTimestampBefore = await lastSwapTimestamp()

            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            const lastSwapTimestampAfter = await lastSwapTimestamp()

            expect(lastSwapTimestampAfter).greaterThan(lastSwapTimestampBefore)
        })

        it('updates nextSwapAmount if a position ends at current swap height', async () => {
            for (let i = 0; i <= positionParams.swaps - 1n; i++) {
                await dca.connect(swapper).swap([
                    {
                        poolId: positionParams.poolId,
                        minOutputAmount: 0,
                    },
                ])

                await NetworkService.fastForwardChain(TWENTY_FOUR_HOURS_IN_SECONDS)
            }

            const nextSwapAmount = (await dca.getPool(positionParams.poolId)).nextSwapAmount

            expect(nextSwapAmount).to.be.equals(0n)
        })

        it('does not update nextSwapAmount if no position ends at current swap height', async () => {
            const nextSwapAmount = async () => (await dca.getPool(positionParams.poolId)).nextSwapAmount
            const nextSwapAmountBefore = await nextSwapAmount()

            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            const nextSwapAmountAfter = await nextSwapAmount()

            expect(nextSwapAmountAfter).to.be.equals(nextSwapAmountBefore)
        })
    })

    describe('REVERTS', () => {
        it('if isnt swapper calling swap function', async () => {
            const tx = dca.connect(account1).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            await expect(tx).to.be.revertedWithCustomError(dca, 'CallerIsNotSwapper')
        })

        it('if swap occurs before the estimated time gap', async () => {
            await dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])
            const tx = dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            await expect(tx).to.be.revertedWithCustomError(dca, 'TooEarlyToSwap')
        })

        it('if swap is called but there are no tokens to swap', async () => {
            for (let i = 0; i <= positionParams.swaps - 1n; i++) {
                await dca.connect(swapper).swap([
                    {
                        poolId: positionParams.poolId,
                        minOutputAmount: 0,
                    },
                ])
                await NetworkService.fastForwardChain(TWENTY_FOUR_HOURS_IN_SECONDS)
            }

            const tx = dca.connect(swapper).swap([
                {
                    poolId: positionParams.poolId,
                    minOutputAmount: 0,
                },
            ])

            await expect(tx).to.be.revertedWithCustomError(dca, 'NoTokensToSwap')
        })

        it('if poolId does not exist', async () => {
            const tx = dca.connect(swapper).swap([
                {
                    poolId: 31,
                    minOutputAmount: 0,
                },
            ])

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPoolId')
        })
    })
})
