import { safes, unwrapAddressLike } from '@defihub/shared'
import { ChainId, EthErrors, notEmpty } from '@ryze-blockchain/ethereum'
import Safe, { EthersAdapter } from '@safe-global/protocol-kit'
import { getAddress, ethers, PreparedTransactionRequest } from 'ethers'
import SafeApiKit from '@safe-global/api-kit'
import { getSigner } from '@src/helpers/deployment-helpers'

export function getSafeAddress(chainId: ChainId) {
    const safe = safes[chainId as keyof typeof safes]

    if (!safe)
        throw new Error(EthErrors.UNSUPPORTED_CHAIN)

    return safe
}

async function getSafe(chainId: ChainId) {
    const signer = await getSigner()
    const ethAdapter = new EthersAdapter({
        ethers: ethers,
        signerOrProvider: signer,
    })

    return {
        signer,
        safe: await Safe.create({
            ethAdapter,
            safeAddress: getAddress(getSafeAddress(chainId)),
        }),
        apiSdk: new SafeApiKit({ chainId: BigInt(chainId) }),
    }
}

async function convertTransactions(transactions: PreparedTransactionRequest[]) {
    return (
        await Promise.all(transactions.map(async transaction => {
            if (!transaction.to || !transaction.data)
                throw new Error('Invalid transaction')

            return {
                to: getAddress(await unwrapAddressLike(transaction.to)),
                value: transaction.value?.toString() || '0',
                data: transaction.data,
            }
        }))
    ).filter(notEmpty)
}

// TODO creating a batch file like in the following example possibly decodes the data properly in the UI
//  https://github.com/safe-global/safe-react-apps/blob/8952156607a0f432555e5d699ec21eaea4f25f67/apps/tx-builder/src/store/transactionLibraryContext.tsx#L267
export async function proposeTransactions(
    chainId: ChainId,
    transactions: PreparedTransactionRequest[],
) {
    const { signer, safe, apiSdk } = await getSafe(chainId)

    const safeTransaction = await safe
        .createTransaction({ transactions: await convertTransactions(transactions) })

    const safeTxHash = await safe
        .getTransactionHash(safeTransaction)

    const senderSignature = await safe
        .signHash(safeTxHash)

    await apiSdk.proposeTransaction({
        safeAddress: getAddress(getSafeAddress(chainId)),
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: getAddress(await signer.getAddress()),
        senderSignature: senderSignature.data,
    })
}
