import { ChainIds } from '@ryze-blockchain/ethereum'
import { PathUniswapV3, tokenAddresses } from '@defihub/shared'

const bnbTestnetTokens = tokenAddresses[ChainIds.BNB_TESTNET]

export const bnbTestnetDcaPools = [
    new PathUniswapV3(
        bnbTestnetTokens.usdt,
        [
            {
                token: bnbTestnetTokens.btcb,
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
        bnbTestnetTokens.btcb,
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
