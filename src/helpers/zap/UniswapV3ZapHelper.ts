import { Slippage } from '@src/helpers'
import { unwrapAddressLike, PathUniswapV3 } from '@defihub/shared'
import { BaseZapHelper } from './BaseZapHelper'
import { ZapProtocols } from './types'
import { NetworkService } from '@src/NetworkService'
import { AddressLike, BigNumberish } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { SwapRouter__factory } from '@src/typechain'

export class UniswapV3ZapHelper extends BaseZapHelper {
    public async encodeExactInputSingle(
        strategyId: bigint,
        product: AddressLike,
        amount: bigint,
        investor: AddressLike,
        inputToken: AddressLike,
        outputToken: AddressLike,
        fee: BigNumberish,
        inputPrice: BigNumber,
        outputPrice: BigNumber,
        slippage: BigNumber,
    ) {
        const amountWithoutFees = await this.getInvestmentAmountWithoutFee(
            strategyId,
            product,
            amount,
            investor,
        )

        const swapBytes = SwapRouter__factory.createInterface().encodeFunctionData(
            'exactInputSingle',
            [
                {
                    tokenIn: await unwrapAddressLike(inputToken),
                    tokenOut: await unwrapAddressLike(outputToken),
                    fee,
                    recipient: await unwrapAddressLike(this.zapManager),
                    deadline: await NetworkService.getDeadline(),
                    amountIn: amountWithoutFees,
                    amountOutMinimum: Slippage.getMinOutput(
                        amountWithoutFees,
                        inputPrice,
                        outputPrice,
                        slippage,
                    ),
                    sqrtPriceLimitX96: 0,
                },
            ],
        )

        return BaseZapHelper.callProtocol(
            ZapProtocols.UniswapV3,
            inputToken,
            outputToken,
            'swap(bytes)',
            await BaseZapHelper.encodeSwap(inputToken, amount, swapBytes),
        )
    }

    // encodes swap and wraps into a zap manager call
    public async encodeExactInput(
        strategyId: bigint,
        product: AddressLike,
        amount: bigint,
        investor: AddressLike,
        path: PathUniswapV3,
        inputPrice: BigNumber,
        outputPrice: BigNumber,
        slippage: BigNumber,
    ) {
        const amountWithoutFees = await this.getInvestmentAmountWithoutFee(
            strategyId,
            product,
            amount,
            investor,
        )

        const swapBytes = SwapRouter__factory.createInterface().encodeFunctionData(
            'exactInput',
            [
                {
                    path: await path.encodedPath(),
                    recipient: await unwrapAddressLike(this.zapManager),
                    deadline: await NetworkService.getDeadline(),
                    amountIn: amountWithoutFees,
                    amountOutMinimum: Slippage.getMinOutput(
                        amountWithoutFees,
                        inputPrice,
                        outputPrice,
                        slippage,
                    ),
                },
            ],
        )

        return BaseZapHelper.callProtocol(
            ZapProtocols.UniswapV3,
            path.inputToken,
            path.outputToken,
            'swap(bytes)',
            await BaseZapHelper.encodeSwap(path.inputToken, amount, swapBytes),
        )
    }
}
