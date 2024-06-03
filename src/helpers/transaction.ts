import {
    getCreateAddress,
    JsonRpcSigner,
    PreparedTransactionRequest,
    Signer,
} from 'ethers'
import { Transaction } from '@ryze-blockchain/ethereum'
import { verify } from './verify'

/**
 * Deploys a contract with a boosted gasLimit to prevent out-of-gas errors
 */
export async function sendDeploymentTransaction(
    bytecode: string,
    deployer: Signer,
    blockInterval = 3,
) {
    const deployerAddress = await deployer.getAddress()
    const expectedContractAddress = getCreateAddress({
        from: deployerAddress,
        nonce: await deployer.getNonce(),
    })

    await sendTransaction({ data: bytecode }, deployer, blockInterval)

    await verify(expectedContractAddress, [])

    return expectedContractAddress
}

export async function sendTransaction(
    preparedTransactionRequest: PreparedTransactionRequest,
    deployer: Signer,
    blockInterval = 5,
) {
    const transaction = await Transaction.initialize(
        preparedTransactionRequest,
        deployer as JsonRpcSigner,
        2_000n,
    )

    await (await transaction.send()).wait(blockInterval)

    return transaction
}

export async function sendLocalDeploymentTransaction(
    bytecode: string,
    deployer: Signer,
) {
    const deployerAddress = await deployer.getAddress()
    const expectedContractAddress = getCreateAddress({
        from: deployerAddress,
        nonce: await deployer.getNonce(),
    })

    await sendTransaction({ data: bytecode }, deployer, 0)

    return expectedContractAddress
}

export async function sendLocalTransaction(
    preparedTransactionRequest: PreparedTransactionRequest,
    deployer: Signer,
) {
    return sendTransaction(preparedTransactionRequest, deployer, 0)
}
