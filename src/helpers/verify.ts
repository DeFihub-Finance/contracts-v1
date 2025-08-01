import hre from 'hardhat'
import { BatchLimiter, sleep } from '@ryze-blockchain/ethereum'

const pendingTransactionMessages = [
    'has no bytecode',
    'does not have bytecode',
    'transaction indexing still in progress',
    'Max calls per sec rate limit reached',
]

const limiter = new BatchLimiter(1, 3_000)

export async function verify<T>(
    address: string,
    constructorArguments: T[] = [],
    contractName?: string,
) {
    try {
        await limiter.consumeLimit()

        await hre.run('verify:verify', {
            address,
            constructorArguments,
            contract: contractName,
        })
    }
    catch (e) {
        const errorMessage = (e as Error).message

        if (pendingTransactionMessages.some(pendingTransactionMessage => errorMessage.includes(pendingTransactionMessage))) {
            console.log('pending contract index')

            await sleep(3_000)

            console.log('retrying verification')

            return verify(address, constructorArguments)
        }

        if (errorMessage.includes('is already verified'))
            return

        throw e
    }
}
