import { BigNumber, ChainIds } from '@ryze-blockchain/ethereum'
import { ERC20Priced, unwrapAddressLike } from '@defihub/shared'
import { AddressLike, ZeroAddress } from 'ethers'

export function mockToken(price: BigNumber, decimals: number, address?: string): ERC20Priced {
    return {
        chainId: ChainIds.ETH,
        address: address || ZeroAddress,
        name: '',
        symbol: '',
        image: '',
        price,
        decimals,
    }
}

export async function mockTokenWithAddress(
    price: BigNumber,
    decimals: number,
    address: AddressLike,
) {
    return mockToken(
        price,
        decimals,
        await unwrapAddressLike(address),
    )
}
