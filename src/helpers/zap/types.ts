export const ZapProtocols = {
    UniswapV2: 'UniswapV2',
    UniswapV3: 'UniswapV3',
} as const

export type ZapProtocol = typeof ZapProtocols[keyof typeof ZapProtocols]

export type ZapperFunctionSignature = 'swap(bytes)' | 'zap(bytes)'
