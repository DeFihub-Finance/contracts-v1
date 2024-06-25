import { UniswapV3Pool } from '@src/typechain'

// TODO update imports
import { Pool } from '@defihub/shared/node_modules/@uniswap/v3-sdk'
import { mockUniV3Token } from './mock-univ3-token'

export async function getUniV3Pool(contract: UniswapV3Pool): Promise<Pool> {
    const [
        token0,
        token1,
        liquidity,
        { sqrtPriceX96, tick },
    ] = await Promise.all([
        contract.token0(),
        contract.token1(),
        contract.liquidity(),
        contract.slot0(),
    ])

    return new Pool(
        mockUniV3Token(token0, 18),
        mockUniV3Token(token1, 18),
        3000,
        sqrtPriceX96.toString(),
        liquidity.toString(),
        Number(tick),
    )
}
