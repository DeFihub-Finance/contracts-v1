import { BlockchainAccountJson, ERC20PricedJson } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { ofetch } from 'ofetch'

export async function getTokenPrices(
    tokenAddresses:  BlockchainAccountJson[],
): Promise<Partial<Record<string, BigNumber>>> {
    const defihubApi = process.env.DEFIHUB_API || 'https://api.defihub.fi'

    const tokens = (await ofetch<ERC20PricedJson[]>(`${ defihubApi }/tokens/get`, {
        method: 'POST',
        body: {
            tokens: tokenAddresses,
        },
    }))

    return tokens.reduce<Partial<Record<string, BigNumber>>>(
        (acc, { address, price }) => {
            acc[address] = new BigNumber(price)

            return acc
        },
        {},
    )
}
