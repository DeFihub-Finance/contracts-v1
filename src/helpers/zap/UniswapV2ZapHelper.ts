import { BigNumber } from '@ryze-blockchain/ethereum'
import { Slippage, unwrapAddressLike, Zapper, ZapperFunctionSignatures } from '@defihub/shared'
import { ZapProtocols } from './types'
import { NetworkService } from '@src/NetworkService'
import { UniswapV2Factory, UniswapV2Router02__factory, ZapManager } from '@src/typechain'
import { AbiCoder, AddressLike } from 'ethers'
import { mockToken } from '@src/helpers/mock-token'

export class UniswapV2ZapHelper {
    // encodes swap and wraps into a zap manager call
    public async encodeSwap(
        amount: bigint,
        inputToken: AddressLike,
        outputToken: AddressLike,
        inputPrice: BigNumber,
        outputPrice: BigNumber,
        slippage: BigNumber,
        recipient: AddressLike,
    ) {
        return Zapper.encodeProtocolCall(
            ZapProtocols.UniswapV2,
            inputToken,
            outputToken,
            ZapperFunctionSignatures.SWAP,
            await this.encodeInternalSwapBytes(
                amount,
                inputToken,
                outputToken,
                inputPrice,
                outputPrice,
                slippage,
                recipient,
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
        recipient: AddressLike,
    ) {
        const swapBytes = UniswapV2Router02__factory.createInterface().encodeFunctionData(
            'swapExactTokensForTokens',
            [
                amount,
                Slippage.getMinOutput(
                    amount,
                    mockToken(inputPrice, 18),
                    mockToken(outputPrice, 18),
                    slippage,
                ),
                [
                    await unwrapAddressLike(inputToken),
                    await unwrapAddressLike(outputToken),
                ],
                await unwrapAddressLike(recipient),
                await NetworkService.getDeadline(),
            ],
        )

        return Zapper.encodeSwap(inputToken, amount, swapBytes)
    }

    public async encodeZap(
        amount: bigint,
        inputToken: AddressLike,
        tokenA: AddressLike,
        tokenB: AddressLike,
        priceInput: BigNumber,
        priceA: BigNumber,
        priceB: BigNumber,
        slippage: BigNumber,
        zapManager: ZapManager,
        uniswapFactory: UniswapV2Factory,
    ) {
        const amountPerSwap = amount / 2n
        const swapA = await this.encodeInternalSwapBytes(
            amountPerSwap,
            inputToken,
            tokenA,
            priceInput,
            priceA,
            slippage,
            zapManager,
        )
        const swapB = await this.encodeInternalSwapBytes(
            amountPerSwap,
            inputToken,
            tokenB,
            priceInput,
            priceB,
            slippage,
            zapManager,
        )
        const zapperCall = new AbiCoder().encode(
            // UniswapV2Zapper.ZapData
            ['tuple(uint,address,address,bytes,bytes,uint,uint)'],
            [
                [
                    amount,
                    await unwrapAddressLike(tokenA),
                    await unwrapAddressLike(tokenB),
                    swapA,
                    swapB,
                    Slippage.getMinOutput(amountPerSwap, mockToken(priceInput, 18), mockToken(priceA, 18), slippage),
                    Slippage.getMinOutput(amountPerSwap, mockToken(priceInput, 18), mockToken(priceB, 18), slippage),
                ],
            ],
        )

        return Zapper.encodeProtocolCall(
            ZapProtocols.UniswapV2,
            inputToken,
            await uniswapFactory.getPair(tokenA, tokenB),
            ZapperFunctionSignatures.ZAP,
            zapperCall,
        )
    }
}
