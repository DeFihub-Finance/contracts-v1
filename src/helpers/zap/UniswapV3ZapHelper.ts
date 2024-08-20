import { unwrapAddressLike, PathUniswapV3, Slippage, Zapper, ZapProtocols, ERC20Priced } from '@defihub/shared'
import { NetworkService } from '@src/NetworkService'
import { AddressLike, BigNumberish } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { SwapRouter__factory } from '@src/typechain'
import { mockToken } from '@src/helpers/mock-token'

export class UniswapV3ZapHelper {
    public static async encodeExactInputSingle(
        amount: bigint,
        inputToken: ERC20Priced,
        outputToken: ERC20Priced,
        fee: BigNumberish,
        slippage: BigNumber,
        recipient: AddressLike,
    ) {
        const swapBytes = SwapRouter__factory.createInterface().encodeFunctionData(
            'exactInputSingle',
            [
                {
                    tokenIn: inputToken.address,
                    tokenOut: outputToken.address,
                    fee,
                    recipient: await unwrapAddressLike(recipient),
                    deadline: await NetworkService.getDeadline(),
                    amountIn: amount,
                    amountOutMinimum: Slippage.getMinOutput(
                        amount,
                        inputToken,
                        outputToken,
                        slippage,
                    ),
                    sqrtPriceLimitX96: 0,
                },
            ],
        )

        return Zapper.encodeProtocolCall(
            ZapProtocols.UniswapV3,
            inputToken.address,
            outputToken.address,
            'swap(bytes)',
            await Zapper.encodeSwap(inputToken.address, amount, swapBytes),
        )
    }

    // encodes swap and wraps into a zap manager call
    public static async encodeExactInput(
        amount: bigint,
        path: PathUniswapV3,
        inputPrice: BigNumber,
        outputPrice: BigNumber,
        slippage: BigNumber,
        recipient: AddressLike,
    ) {
        const swapBytes = SwapRouter__factory.createInterface().encodeFunctionData(
            'exactInput',
            [
                {
                    path: await path.encodedPath(),
                    recipient: await unwrapAddressLike(recipient),
                    deadline: await NetworkService.getDeadline(),
                    amountIn: amount,
                    amountOutMinimum: Slippage.getMinOutput(
                        amount,
                        mockToken(inputPrice, 18),
                        mockToken(outputPrice, 18),
                        slippage,
                    ),
                },
            ],
        )

        return Zapper.encodeProtocolCall(
            ZapProtocols.UniswapV3,
            path.inputToken,
            path.outputToken,
            'swap(bytes)',
            await Zapper.encodeSwap(path.inputToken, amount, swapBytes),
        )
    }
}
