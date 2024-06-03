import { PathUniswapV3 } from '@defihub/shared'

export function invertPathUniswapV3(pool: PathUniswapV3) {
    const reversedHops: PathUniswapV3['hops'] = []
    const originalHops = pool.hops

    // Iterates from the last hop to the second hop (excluding the first hop)
    for (let index = originalHops.length - 1; index > 0; index--) {
        reversedHops.push({
            token: originalHops[index - 1].token,
            fee: originalHops[index].fee,
        })
    }

    reversedHops.push({
        token: pool.inputToken, // Original inputToken becomes the last token in the hops
        fee: originalHops[0].fee,
    })

    return new PathUniswapV3(
        pool.outputToken, // Last token becomes the new input token
        reversedHops,
    )
}
