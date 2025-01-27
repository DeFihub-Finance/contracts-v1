import { unwrapAddressLike, PathUniswapV3, Slippage, TokenQuote, RoutePlanner, UniversalRouterCommand } from '@defihub/shared'
import { AddressLike } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { UniversalRouter } from '@src/typechain'

export class SwapEncoder {
    public static async encodeExactInputV2(
        router: UniversalRouter,
        amount: bigint,
        path: AddressLike[],
        inputToken: TokenQuote,
        outputToken: TokenQuote,
        slippage: BigNumber,
        recipient: AddressLike,
    ) {
        return new RoutePlanner(await unwrapAddressLike(router))
            .addCommand(
                UniversalRouterCommand.V2_SWAP_EXACT_IN,
                [
                    await unwrapAddressLike(recipient),
                    amount,
                    Slippage.getMinOutput(
                        amount,
                        inputToken,
                        outputToken,
                        slippage,
                    ),
                    await Promise.all(path.map(addr => unwrapAddressLike(addr))),
                    false,
                ],
            )
            .encodedSwapData
    }

    public static async encodeExactInputV3(
        router: UniversalRouter,
        amount: bigint,
        path: PathUniswapV3,
        inputToken: TokenQuote,
        outputToken: TokenQuote,
        slippage: BigNumber,
        recipient: AddressLike,
    ) {
        return new RoutePlanner(await unwrapAddressLike(router))
            .addCommand(
                UniversalRouterCommand.V3_SWAP_EXACT_IN,
                [
                    await unwrapAddressLike(recipient),
                    amount,
                    Slippage.getMinOutput(
                        amount,
                        inputToken,
                        outputToken,
                        slippage,
                    ),
                    path.encodedPath(),
                    false,
                ],
            )
            .encodedSwapData
    }
}
