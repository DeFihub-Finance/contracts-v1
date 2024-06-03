import { expect } from 'chai'
import { Signer  } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { baseUseFeeFixture } from './fixture/base.fixture'
import { TestFee } from '@src/typechain'

// given the owner of a UseFee contract
//      when they call setFee where  base fee and non-subscriber fee are less than MAX_FEE
//          then the base fee is set correctly
//          then the non-subscriber fee is set correctly
//      when they call setFee where the base fee is greater than MAX_FEE
//          then emits FeeTooHigh
//      when they call setFee where the non-subscriber fee is greater than MAX_FEE
//          then emits FeeTooHigh
//
// given an account which is not the owner of a UseFee contract
//    when they call setFee
//          then emits CallerNotOwner
describe('UseFee#calculateFee', () => {
    let useFee: TestFee
    let account0: Signer

    const baseFee = 70n
    const nonSubscriberFee = 30n

    beforeEach(async () => {
        ({
            useFee,
            account0,
        } = await loadFixture(baseUseFeeFixture))
    })

    describe('given the owner of a UseFee contract', () => {
        describe('when they call setFee where  base fee and non-subscriber fee are less than MAX_FEE', () => {
            it('then the base fee is set correctly', async () => {
                await useFee.setFee(baseFee, nonSubscriberFee)
                expect(await useFee.baseFeeBP()).to.equal(baseFee)
            })

            it('then the non-subscriber fee is set correctly', async () => {
                await useFee.setFee(baseFee, nonSubscriberFee)
                expect(await useFee.nonSubscriberFeeBP()).to.equal(nonSubscriberFee)
            })
        })

        describe('when they call setFee where base fee is greater than MAX_FEE', () => {
            it('then emits FeeTooHigh', async () => {
                await expect(useFee.setFee(1_001n, nonSubscriberFee))
                    .to.be.revertedWithCustomError(useFee, 'FeeTooHigh')
            })
        })

        describe('when they call setFee where non-subscriber fee is greater than MAX_FEE', () => {
            it('then emits FeeTooHigh', async () => {
                await expect(useFee.setFee(baseFee, 1_001n))
                    .to.be.revertedWithCustomError(useFee, 'FeeTooHigh')
            })
        })

    })

    describe('given an account which is not the owner of a UseFee contract', () => {
        it('when they call setFee then emits CallerNotOwner', async () => {
            await expect(useFee.connect(account0).setFee(baseFee, nonSubscriberFee))
                .to.be.revertedWith('Ownable: caller is not the owner')
        })
    })
})
