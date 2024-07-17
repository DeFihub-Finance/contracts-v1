import { UniswapV2ZapHelper, UniswapV3ZapHelper } from '../zap'

type Protocol = 'uniswapV2' | 'uniswapV3'
type UniswapV2ZapHelperParams = Parameters<typeof UniswapV2ZapHelper.encodeSwap>
type UniswapV3ZapHelperParams = Parameters<typeof UniswapV3ZapHelper.encodeExactInputSingle>

type EncodedSwapParams<T> = T extends 'uniswapV2' ? UniswapV2ZapHelperParams : UniswapV3ZapHelperParams

export function getEncodedSwap<T extends Protocol>(
    protocol: T,
    ...args: EncodedSwapParams<T>
) {
    return protocol === 'uniswapV2'
        ? UniswapV2ZapHelper.encodeSwap(...(args as UniswapV2ZapHelperParams))
        : UniswapV3ZapHelper.encodeExactInputSingle(...(args as UniswapV3ZapHelperParams))
}
