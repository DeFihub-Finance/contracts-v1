import { ChainIds } from '@ryze-blockchain/ethereum'
import { PathUniswapV3 } from '@defihub/shared'
import { tokens } from '../tokens'

const arbTokens = tokens[ChainIds.ARBITRUM]

export const arbitrumDcaPools = [
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.wbtc,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.wsteth,
                fee: 100,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.uni,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.crv,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.grt,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.gmx,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.pendle,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.arb,
                fee: 500,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.link,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.pepe,
                fee: 10_000,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            {
                token: arbTokens.lido,
                fee: 3_000,
            },
        ],
    ),
    new PathUniswapV3(
        arbTokens.usdc,
        [
            {
                token: arbTokens.weth,
                fee: 500,
            },
            // TODO doge not yet deployed
            {
                token: arbTokens.doge,
                fee: 3_000,
            },
        ],
    ),
]
