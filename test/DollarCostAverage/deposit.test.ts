import { DollarCostAverage, SubscriptionManager } from '@src/typechain'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { PositionParams, baseDcaFixture } from './fixtures/base.fixture'
import { Signer, ZeroHash } from 'ethers'
import { ethers } from 'hardhat'
import { ERC20 } from '@src/typechain'
import { ContractFees } from '@src/ContractFees'
import { NetworkService } from '@src/NetworkService'
import { SubscriptionSignature } from '@src/SubscriptionSignature'

const fakePermit: SubscriptionManager.PermitStruct = {
    r: ethers.getBytes(ZeroHash),
    s: ethers.getBytes(ZeroHash),
    v: 0n,
    deadline: 0n,
}

// EFFECTS
// => deposit and create new position
// => transfer tokens from user to contract
// => emit CreatePosition event
//
// SIDE EFFECTS
// => update pool's nextSwapAmount
//
// REVERTS
// => if poolId >= number of pools
// => if amount  is zero
// => swaps is zero
describe('DCA#deposit', () => {
    let account0: Signer
    let treasury: Signer
    let subscriptionSigner: Signer
    let subscriptionManager: SubscriptionManager
    let dca: DollarCostAverage
    let positionParams: PositionParams
    let stablecoin: ERC20

    beforeEach(async () => {
        ({
            account0,
            treasury,
            dca,
            positionParams,
            stablecoin,
            subscriptionManager,
            subscriptionSigner,
        } = await loadFixture(baseDcaFixture))
    })

    describe('EFFECT', () => {
        it('deposit and create new position', async () => {
            await dca.connect(account0).deposit(
                positionParams.poolId,
                positionParams.swaps,
                positionParams.depositAmount,
                fakePermit,
            )

            const pool = await dca.getPool(positionParams.poolId)
            const position = await dca.getPosition(await account0.getAddress(), positionParams.positionId)

            expect(position.swaps).to.be.equals(positionParams.swaps)
            expect(position.finalSwap).to.be.equals(pool.performedSwaps + positionParams.swaps)
            expect(position.lastUpdateSwap).to.be.equals(0)
            expect(position.poolId).to.be.equals(positionParams.poolId)
            expect(position.amountPerSwap).to.be.deep.equals(
                ContractFees.discountNonSubscriberFee(positionParams.depositAmount) / positionParams.swaps,
            )
        })

        it('transfer deposit fee to treasury for non-subscriber', async () => {
            const treasuryBalanceBefore = await stablecoin.balanceOf(await treasury.getAddress())

            await dca.connect(account0).deposit(
                positionParams.poolId,
                positionParams.swaps,
                positionParams.depositAmount,
                fakePermit,
            )

            const treasuryOutputTokenBalanceDelta = (await stablecoin.balanceOf(await treasury.getAddress())) - treasuryBalanceBefore

            expect(treasuryOutputTokenBalanceDelta)
                .to.be.equal(ContractFees.getNonSubscriberFee(positionParams.depositAmount))
        })

        it('transfer deposit fee to treasury for subscriber', async () => {
            const signature = await new SubscriptionSignature(subscriptionManager, subscriptionSigner)
                .signSubscriptionPermit(
                    await account0.getAddress(),
                    await NetworkService.getBlockTimestamp() + 10_000,
                )

            const treasuryBalanceBefore = await stablecoin.balanceOf(await treasury.getAddress())

            await dca.connect(account0).deposit(
                positionParams.poolId,
                positionParams.swaps,
                positionParams.depositAmount,
                signature,
            )

            const treasuryOutputTokenBalanceDelta = (await stablecoin.balanceOf(await treasury.getAddress())) - treasuryBalanceBefore

            expect(treasuryOutputTokenBalanceDelta)
                .to.be.equal(ContractFees.getBaseFee(positionParams.depositAmount))
        })

        it('emits CreatePosition after position created', async () => {
            const amountPerSwap = ContractFees.discountNonSubscriberFee(positionParams.depositAmount) / positionParams.swaps
            const pool = await dca.getPool(positionParams.poolId)

            const tx = dca.connect(account0).deposit(
                positionParams.poolId,
                positionParams.swaps,
                positionParams.depositAmount,
                fakePermit,
            )

            await expect(tx).to.emit(dca, 'PositionCreated').withArgs(
                await account0.getAddress(),
                positionParams.poolId,
                positionParams.positionId,
                positionParams.swaps,
                amountPerSwap,
                pool.performedSwaps + positionParams.swaps,
            )
        })

        it('transfers the amount of tokens specified by the user', async () => {
            const pool = await dca.getPool(positionParams.poolId)
            const balanceBefore = await dca.tokenBalance(pool.inputToken)
            const treasuryBalanceBefore = await stablecoin.balanceOf(await treasury.getAddress())

            await dca.connect(account0).deposit(
                positionParams.poolId,
                positionParams.swaps,
                positionParams.depositAmount,
                fakePermit,
            )

            const balanceAfter = await dca.tokenBalance(pool.inputToken)
            const treasuryBalanceAfter = await stablecoin.balanceOf(await treasury.getAddress())

            expect(balanceAfter - balanceBefore).to.be.equals(ContractFees.discountNonSubscriberFee(
                positionParams.depositAmount,
            ))
            expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.equals(
                ContractFees.getNonSubscriberFee(positionParams.depositAmount),
            )
        })
    })

    describe('SIDE EFFECTS', () => {
        it('updates pools nextSwapAmount', async () => {
            const nextSwapAmount = async () => (await dca.getPool(positionParams.poolId)).nextSwapAmount
            const nextSwapAmountBefore = await nextSwapAmount()

            await dca.connect(account0).deposit(
                positionParams.poolId,
                positionParams.swaps,
                positionParams.depositAmount,
                fakePermit,
            )

            const nextSwapAmountDelta = (await nextSwapAmount()) - nextSwapAmountBefore

            expect(nextSwapAmountDelta).to.be.deep.equal(
                ContractFees.discountNonSubscriberFee(positionParams.depositAmount) / positionParams.swaps,
            )
        })
    })

    describe('REVERTS', () => {
        it('if poolId >= number of pools', async () => {
            const tx = dca.connect(account0).deposit(
                31,
                positionParams.swaps,
                positionParams.depositAmount,
                fakePermit,
            )

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidPoolId')
        })

        it('if amount is zero', async () => {
            const tx = dca.connect(account0).deposit(
                positionParams.poolId,
                positionParams.swaps,
                0n,
                fakePermit,
            )

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidDepositAmount')
        })

        it('if swaps is zero', async () => {
            const tx = dca.connect(account0).deposit(
                positionParams.poolId,
                0,
                positionParams.depositAmount,
                fakePermit,
            )

            await expect(tx).to.be.revertedWithCustomError(dca, 'InvalidNumberOfSwaps')
        })
    })

})
