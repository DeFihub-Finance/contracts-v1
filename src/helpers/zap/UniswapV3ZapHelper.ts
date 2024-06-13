import { unwrapAddressLike, PathUniswapV3, Slippage, Zapper } from '@defihub/shared'
import { ZapProtocols } from './types'
import { NetworkService } from '@src/NetworkService'
import { AddressLike, BigNumberish } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { SwapRouter__factory } from '@src/typechain'
import { mockToken } from '@src/helpers/mock-token'

export class UniswapV3ZapHelper {
    public async encodeExactInputSingle(
        amount: bigint,
        inputToken: AddressLike,
        outputToken: AddressLike,
        fee: BigNumberish,
        inputPrice: BigNumber,
        outputPrice: BigNumber,
        slippage: BigNumber,
        recipient: AddressLike,
    ) {
        const swapBytes = SwapRouter__factory.createInterface().encodeFunctionData(
            'exactInputSingle',
            [
                {
                    tokenIn: await unwrapAddressLike(inputToken),
                    tokenOut: await unwrapAddressLike(outputToken),
                    fee,
                    recipient: await unwrapAddressLike(recipient),
                    deadline: await NetworkService.getDeadline(),
                    amountIn: amount,
                    amountOutMinimum: Slippage.getMinOutput(
                        amount,
                        mockToken(inputPrice, 18),
                        mockToken(outputPrice, 18),
                        slippage,
                    ),
                    sqrtPriceLimitX96: 0,
                },
            ],
        )

        return Zapper.encodeProtocolCall(
            ZapProtocols.UniswapV3,
            inputToken,
            outputToken,
            'swap(bytes)',
            await Zapper.encodeSwap(inputToken, amount, swapBytes),
        )
    }

    // encodes swap and wraps into a zap manager call
    public async encodeExactInput(
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
