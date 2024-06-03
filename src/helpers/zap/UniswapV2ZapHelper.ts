import { BigNumber } from '@ryze-blockchain/ethereum'
import { unwrapAddressLike } from '@defihub/shared'
import { BaseZapHelper } from './BaseZapHelper'
import { ZapProtocols } from './types'
import { NetworkService } from '@src/NetworkService'
import { UniswapV2Factory, UniswapV2Router02__factory } from '@src/typechain'
import { AbiCoder, AddressLike } from 'ethers'
import { Slippage } from '@src/helpers'

export class UniswapV2ZapHelper extends BaseZapHelper {
    // encodes swap and wraps into a zap manager call
    public async encodeSwap(
        strategyId: bigint,
        product: AddressLike,
        amount: bigint,
        investor: AddressLike,
        inputToken: AddressLike,
        outputToken: AddressLike,
        inputPrice: BigNumber,
        outputPrice: BigNumber,
        slippage: BigNumber,
    ) {
        const amountWithoutFee = await this.getInvestmentAmountWithoutFee(
            strategyId,
            product,
            amount,
            investor,
        )

        return BaseZapHelper.callProtocol(
            ZapProtocols.UniswapV2,
            inputToken,
            outputToken,
            'swap(bytes)',
            await this.encodeInternalSwapBytes(
                amountWithoutFee,
                inputToken,
                outputToken,
                inputPrice,
                outputPrice,
                slippage,
            ),
        )
    }

    // encodes swap to execute inside the Zapper implementation
    private async encodeInternalSwapBytes(
        amount: bigint,
        inputToken: AddressLike,
        outputToken: AddressLike,
        inputPrice: BigNumber,
        outputPrice: BigNumber,
        slippage: BigNumber,
    ) {
        const swapBytes = UniswapV2Router02__factory.createInterface().encodeFunctionData(
            'swapExactTokensForTokens',
            [
                amount,
                Slippage.getMinOutput(
                    amount,
                    inputPrice,
                    outputPrice,
                    slippage,
                ),
                [
                    await unwrapAddressLike(inputToken),
                    await unwrapAddressLike(outputToken),
                ],
                await unwrapAddressLike(this.zapManager),
                await NetworkService.getDeadline(),
            ],
        )

        return BaseZapHelper.encodeSwap(inputToken, amount, swapBytes)
    }

    public async encodeZap(
        strategyId: bigint,
        product: AddressLike,
        amount: bigint,
        investor: AddressLike,
        inputToken: AddressLike,
        tokenA: AddressLike,
        tokenB: AddressLike,
        priceInput: BigNumber,
        priceA: BigNumber,
        priceB: BigNumber,
        slippage: BigNumber,
        uniswapFactory: UniswapV2Factory,
    ) {
        const realAmount = await this.getInvestmentAmountWithoutFee(
            strategyId,
            product,
            amount,
            investor,
        )
        const amountPerSwap = realAmount / 2n
        const swapA = await this.encodeInternalSwapBytes(
            amountPerSwap,
            inputToken,
            tokenA,
            priceInput,
            priceA,
            slippage,
        )
        const swapB = await this.encodeInternalSwapBytes(
            amountPerSwap,
            inputToken,
            tokenB,
            priceInput,
            priceB,
            slippage,
        )
        const zapperCall = new AbiCoder().encode(
            ['tuple(uint,address,address,bytes,bytes,uint,uint)'],
            [
                [
                    realAmount,
                    await unwrapAddressLike(tokenA),
                    await unwrapAddressLike(tokenB),
                    swapA,
                    swapB,
                    Slippage.getMinOutput(amountPerSwap, priceInput, priceA, slippage),
                    Slippage.getMinOutput(amountPerSwap, priceInput, priceB, slippage),
                ],
            ],
        )

        return BaseZapHelper.callProtocol(
            ZapProtocols.UniswapV2,
            inputToken,
            await uniswapFactory.getPair(tokenA, tokenB),
            'zap(bytes)',
            zapperCall,
        )
    }
}
