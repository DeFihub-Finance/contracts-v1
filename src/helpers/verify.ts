import hre from 'hardhat'
import { sleep } from '@ryze-blockchain/ethereum'

export async function verify<T>(
    address: string,
    constructorArguments: T[] = [],
    contractName?: string,
) {
    try {
        await hre.run('verify:verify', {
            address,
            constructorArguments,
            contract: contractName,
        })
    }
    catch (e) {
        const message = (e as Error).message

        if (message.includes('has no bytecode') || message.includes('does not have bytecode')) {
            console.log('pending contract index')

            await sleep(3_000)

            console.log('retrying verification')

            return verify(address, constructorArguments)
        }

        throw e
    }
}
