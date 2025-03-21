import { PathUniswapV3 } from '@defihub/shared'
import { DollarCostAverage, TestERC20 } from '@src/typechain'
import { Signer, ZeroAddress } from 'ethers'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { PositionParams, baseDcaFixture } from './fixtures/base.fixture'

// MAIN EFFECTS
// => set contract variables
//
// SIDE EFFECTS
// none
//
// REVERTS
// => if treasury addresss is invalid
// => if router address is invalid
// => if poolpath.length < 2
// => if poolpath[0] != tokenIn or poolPath[poolpath.length - 1] != tokenOut
describe('DCA#setters', () => {
    let dca: DollarCostAverage
    let account1: Signer
    let account2: Signer

    let positionParams: PositionParams
    let wbtc: TestERC20

    let stablecoin: TestERC20
    let weth: TestERC20

    beforeEach(async () => {
        ({
            dca,
            account1,
            account2,
            positionParams,
            stablecoin,
            weth,
            wbtc,
        } = await loadFixture(baseDcaFixture))
    })

    describe('EFFECTS', () => {
        it('sets a new treasury address', async () => {
            await dca.setTreasury(account2)

            const newTreasuryAddress = await dca.treasury()

            expect(newTreasuryAddress).to.be.equal(await account2.getAddress())
        })

        it('emits SetTreasury event when treasury gets updated', async () => {
            const tx = dca.setTreasury(account1)

            await expect(tx).to.emit(dca, 'TreasuryUpdated').withArgs(await account1.getAddress())
        })

        it('sets a new path for a given pool', async () => {
            const newPath = await PathUniswapV3.fromAddressLike(
                stablecoin,
                [
                    { fee: 3000, token: wbtc },
                    { fee: 3000, token: weth },
                ],
            )

            const newEncodedPath = newPath.encodedPath()

            for (let i = 0; i < 10; i++)
                await dca.setPoolPath(positionParams.poolId, newEncodedPath)

            const poolPath = await dca.poolPath(positionParams.poolId)

            expect(poolPath).to.be.deep.equal(newEncodedPath)
        })

        it('sets a new router to pool', async () => {
            await dca.setPoolRouter(positionParams.poolId, account2)

            const { router } = await dca.getPool(positionParams.poolId)

            expect(router).to.be.equal(account2)
        })

        it('emits SetPoolRouter event after a new router is set', async () => {
            const oldRouter = (await dca.getPool(positionParams.poolId)).router

            const tx = dca.setPoolRouter(positionParams.poolId, account2)

            await expect(tx).to.emit(dca, 'SetPoolRouter').withArgs(positionParams.poolId, oldRouter, account2)
        })

        it('sets a new swapper address', async () => {
            const newSwapper = await account2.getAddress()

            await dca.setSwapper(newSwapper)

            const swapper = await dca.swapper()

            expect(swapper).to.be.equals(newSwapper)
        })

        it('emits SetSwapper after a new swapper is set', async () => {
            const oldSwapper = await dca.swapper()

            const tx = dca.setSwapper(account2)

            await expect(tx).to.emit(dca, 'SetSwapper').withArgs(oldSwapper, account2)
        })
    })

    describe('REVERTS', () => {
        it('if router address is 0x0', async () => {
            const tx = dca.setPoolRouter(positionParams.poolId, ZeroAddress)

            await expect(tx).to.revertedWithCustomError(dca, 'InvalidZeroAddress')
        })

        it('if treasury address is 0x0', async () => {
            const tx = dca.setTreasury(ZeroAddress)

            await expect(tx).to.revertedWithCustomError(dca, 'InvalidZeroAddress')
        })

        it('if treasury address is 0x0', async () => {
            const tx = dca.setSwapper(ZeroAddress)

            await expect(tx).to.revertedWithCustomError(dca, 'InvalidZeroAddress')
        })

        it('pool path length is less than one', async () => {
            const tx = dca.setPoolPath(positionParams.poolId, '0x')

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPoolPath')
        })

        it('if poolPath[0] is different than tokenIn', async () => {
            const newPath = await PathUniswapV3.fromAddressLike(wbtc, [{ fee: 3000, token: weth }])

            const tx = dca.setPoolPath(positionParams.poolId, newPath.encodedPath())

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPoolPath')
        })

        it('if poolPath[length - 1] is different than tokenOut', async () => {
            const newPath = await PathUniswapV3.fromAddressLike(stablecoin, [{ fee: 3000, token: wbtc }])

            const tx = dca.setPoolPath(positionParams.poolId, newPath.encodedPath())

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPoolPath')
        })
    })
})
