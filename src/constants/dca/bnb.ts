import { PathUniswapV3 } from '@defihub/shared'
import { tokens } from '@src/constants'
import { ChainIds } from '@ryze-blockchain/ethereum'

const bnbTokens = tokens[ChainIds.BNB]

export const bnbDcaPools = [
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.btcb,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.eth,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTokens.doge,
                fee: 2_500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTokens.aave,
                fee: 10_000,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTokens.link,
                fee: 2_500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.cake,
                fee: 2_500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.sol,
                fee: 2500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTokens.xrp,
                fee: 2_500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTokens.pepe,
                fee: 10_000,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTokens.shib,
                fee: 2_500,
            },
        ],
    ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTokens.matic,
                fee: 2_500,
            },
        ],
    ),
    // disabled since alpaca token looks dead
    // new PathUniswapV3(
    //     bnbTokens.usdt,
    //     [
    //         {
    //             token: bnbTokens.alpaca,
    //             fee: 10_000,
    //         },
    //     ],
    // ),
    new PathUniswapV3(
        bnbTokens.usdt,
        [
            {
                token: bnbTokens.wbnb,
                fee: 500,
            },
            {
                token: bnbTokens.xvs,
                fee: 2_500,
            },
        ],
    ),
]
