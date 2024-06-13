import { BigNumber, ChainIds } from '@ryze-blockchain/ethereum'
import { ERC20Priced } from '@defihub/shared'
import { ZeroAddress } from 'ethers'

export function mockToken(price: BigNumber, decimals: number): ERC20Priced {
    return {
        chainId: ChainIds.ETH,
        address: ZeroAddress,
        name: '',
        symbol: '',
        image: '',
        price,
        decimals,
    }
}
