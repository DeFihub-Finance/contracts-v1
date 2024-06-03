import { DollarCostAverage, SwapRouter, TestERC20 } from '@src/typechain'
import { Signer } from 'ethers'
import { baseDcaFixture } from './fixtures/base.fixture'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { PathUniswapV3 } from '@defihub/shared'

describe('DCA#createPool', () => {
    let account0: Signer
    let dca: DollarCostAverage
    let routerUniV3: SwapRouter
    let wbtc: TestERC20
    let tokenIn: TestERC20
    let tokenOut: TestERC20

    let TWENTY_FOUR_HOURS_IN_SECONDS: number
    let path: PathUniswapV3

    let encodedSingleHopPath: string

    beforeEach(async () => {
        ({
            account0,
            dca,
            path,
            wbtc,
            tokenIn,
            tokenOut,
            routerUniV3,
            TWENTY_FOUR_HOURS_IN_SECONDS,
        } = await loadFixture(baseDcaFixture))

        encodedSingleHopPath = await new PathUniswapV3(tokenIn, [{ token: tokenOut, fee: 3000 }])
            .encodedPath()
    })

    describe('EFFECTS', () => {
        let poolId: bigint

        beforeEach(async () => {
            poolId = await dca.getPoolsLength()
        })

        it('creates a new pool', async () => {
            await dca.createPool(
                tokenIn,
                tokenOut,
                routerUniV3,
                await path.encodedPath(),
                TWENTY_FOUR_HOURS_IN_SECONDS,
            )

            const [
                {
                    inputToken,
                    outputToken,
                    router,
                    nextSwapAmount,
                    performedSwaps,
                }, poolPath,
            ] = await Promise.all([
                dca.getPool(poolId),
                dca.poolPath(poolId),
            ])

            expect(inputToken).to.be.equal(tokenIn)
            expect(outputToken).to.be.equal(tokenOut)
            expect(router).to.be.equal(routerUniV3)
            expect(poolPath).to.be.deep.equal(encodedSingleHopPath)
            expect(nextSwapAmount).to.be.equals(0n)
            expect(performedSwaps).to.be.equals(0n)
        })

        it('emit CreatePosition after position created', async () => {
            const tx = dca.createPool(
                tokenIn,
                tokenOut,
                routerUniV3,
                await path.encodedPath(),
                TWENTY_FOUR_HOURS_IN_SECONDS,
            )

            await expect(tx).to.emit(dca, 'PoolCreated').withArgs(
                poolId,
                tokenIn,
                tokenOut,
                routerUniV3,
                encodedSingleHopPath.toLowerCase(),
                TWENTY_FOUR_HOURS_IN_SECONDS,
            )
        })
    })

    describe('REVERTS', () => {
        it('if poolPath[0] is different than tokenIn', async () => {
            const tx = dca.createPool(
                tokenIn,
                tokenOut,
                routerUniV3,
                await new PathUniswapV3(
                    wbtc,
                    [{ token: tokenOut, fee: 3000 }],
                ).encodedPath(),
                TWENTY_FOUR_HOURS_IN_SECONDS,
            )

            expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPoolPath')
        })

        it('if poolPath[length - 1] is different than tokenOut', async () => {
            const tx = dca.createPool(
                tokenIn,
                tokenOut,
                routerUniV3,
                await new PathUniswapV3(
                    tokenIn,
                    [{ token: wbtc, fee: 3000 }],
                ).encodedPath(),
                TWENTY_FOUR_HOURS_IN_SECONDS,
            )

            expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPoolPath')
        })

        it('if EOA is not owner', async () => {
            const tx = dca.connect(account0).createPool(
                tokenIn,
                tokenOut,
                routerUniV3,
                await path.encodedPath(),
                TWENTY_FOUR_HOURS_IN_SECONDS,
            )

            await expect(tx).to.be.revertedWith('Ownable: caller is not the owner')
        })

        it ('if interval in less than the min interval', async () => {
            const tx = dca.createPool(
                tokenIn,
                tokenOut,
                routerUniV3,
                await path.encodedPath(),
                60 * 60,
            )

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPoolInterval')
        })
    })
})
