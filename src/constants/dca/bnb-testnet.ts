import { tokens } from '../tokens'
import { ChainIds } from '@ryze-blockchain/ethereum'
import { PathUniswapV3 } from '@defihub/shared'

const bnbTestnetTokens = tokens[ChainIds.BNB_TESTNET]

export const bnbTestnetDcaPools = [
    new PathUniswapV3(
        bnbTestnetTokens.usdt,
        [
            {
                token: bnbTestnetTokens.wbtc,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTestnetTokens.usdt,
        [
            {
                token: bnbTestnetTokens.weth,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTestnetTokens.usdt,
        [
            {
                token: bnbTestnetTokens.wbnb,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTestnetTokens.wbtc,
        [
            {
                token: bnbTestnetTokens.usdt,
                fee: 3_000,
            },
            {
                token: bnbTestnetTokens.weth,
                fee: 3_000,
            },
        ],
    ),
]
