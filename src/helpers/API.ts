import {
    reduceTokensByAddress,
    BlockchainAccountJson,
    ERC20PricedJson,
    SwapUniswapV3,
    SwapUniswapV3JSON,
} from '@defihub/shared'
import { ChainId } from '@ryze-blockchain/ethereum'
import { ofetch } from 'ofetch'

export class API {
    public static readonly defiHubApi = process.env.DEFIHUB_API || 'https://api.defihub.fi'

    public static async getSwapPath(
        chainId: ChainId,
        inputToken: string,
        outputToken: string,
        inputAmount: bigint,
    ) {
        const rawData = await ofetch<SwapUniswapV3JSON | undefined>(`${ API.defiHubApi }/exchanges/paths/get`, {
            method: 'POST',
            body: {
                chainId,
                inputToken,
                outputToken,
                inputAmount: inputAmount.toString(),
            },
        })

        return rawData ? SwapUniswapV3.fromJSON(rawData) : undefined
    }

    public static async getTokens(tokenAddresses: BlockchainAccountJson[]) {
        const tokens = (await ofetch<ERC20PricedJson[]>(`${ API.defiHubApi }/tokens/get`, {
            method: 'POST',
            body: {
                tokens: tokenAddresses,
            },
        }))

        return reduceTokensByAddress(tokens)
    }
}

