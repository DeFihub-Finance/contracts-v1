import { expect } from 'chai'
import { ContractTransactionResponse, ErrorDescription } from 'ethers'
import { decodeLowLevelCallError } from '@src/helpers'

export async function expectCustomError(
    transaction: Promise<ContractTransactionResponse>,
    errorName: string,
) {
    try {
        await transaction

        throw new Error(`Transaction should have failed with ${ errorName }, but it was confirmed`)
    }
    catch (error) {
        const decodedError = decodeLowLevelCallError(error)

        expect(decodedError).to.be.instanceof(ErrorDescription)
        expect((decodedError as ErrorDescription).name).to.equal(errorName)
    }
}
