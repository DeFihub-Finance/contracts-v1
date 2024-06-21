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
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTestnetTokens.usdt,
        [
            {
                token: bnbTestnetTokens.weth,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTestnetTokens.usdt,
        [
            {
                token: bnbTestnetTokens.wbnb,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTestnetTokens.usdc,
        [
            {
                token: bnbTestnetTokens.wbnb,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTestnetTokens.usdc,
        [
            {
                token: bnbTestnetTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTestnetTokens.usdt,
                fee: 500,
            },
            {
                token: bnbTestnetTokens.wbtc,
                fee: 500,
            },
        ],
    ),
]
