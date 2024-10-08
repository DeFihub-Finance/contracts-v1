import { tokenAddresses } from '@defihub/shared'
import { ChainIds } from '@ryze-blockchain/ethereum'

export const mockStrategies = [
    {
        name: 'Buy crypto and sell it over time',
        bio: 'This strategy is designed to buy crypto and sell it over time. It is a simple strategy that is easy to understand and execute. It is suitable for beginners who want to invest in crypto but do not have the time or expertise to actively manage investments.',
        dcaInvestments: [
            {
                poolId: 4,
                swaps: 30,
                percentage: 35,
            },
            {
                poolId: 5,
                swaps: 30,
                percentage: 35,
            },
            {
                poolId: 6,
                swaps: 30,
                percentage: 30,
            },
        ],
        vaultInvestments: [],
    },
    {
        name: 'Multi-period BTC DCA',
        bio: 'Invest into multiple dca DCA\'s with different durations',
        dcaInvestments: [
            {
                poolId: 0,
                swaps: 10,
                percentage: 50,
            },
            {
                poolId: 0,
                swaps: 30,
                percentage: 30,
            },
            {
                poolId: 0,
                swaps: 60,
                percentage: 20,
            },
        ],
        vaultInvestments: [],
    },
    {
        name: 'A little bit of everything',
        bio: 'A little bit of everything is a forward-thinking framework. It combines planning, simulation exercises, data analytics, and creative workshops to enhance strategic agility and resilience, enabling proactive decision-making in uncertain environments.',
        dcaInvestments: [
            {
                poolId: 0,
                swaps: 30,
                percentage: 10,
            },
            {
                poolId: 1,
                swaps: 30,
                percentage: 10,
            },
            {
                poolId: 2,
                swaps: 30,
                percentage: 10,
            },
        ],
        vaultInvestments: [
            {
                vault: '0x5c1348d96eee708c52545edb06e1ec6f35306a72',
                percentage: 10,
            },
            {
                vault: '0x9ff95fc55a294d7066d1cf88b0d1a0324e75a0ce',
                percentage: 10,
            },
        ],
        liquidityInvestments: [
            {
                tokenA: tokenAddresses[ChainIds.BNB_TESTNET].usdt,
                tokenB: tokenAddresses[ChainIds.BNB_TESTNET].btcb,
                lowerPricePercentage: -100_000,
                upperPricePercentage: 300_000,
                percentage: 10,
            },
            {
                tokenA: tokenAddresses[ChainIds.BNB_TESTNET].usdt,
                tokenB: tokenAddresses[ChainIds.BNB_TESTNET].weth,
                lowerPricePercentage: -100_000,
                upperPricePercentage: 300_000,
                percentage: 10,
            },
            {
                tokenA: tokenAddresses[ChainIds.BNB_TESTNET].btcb,
                tokenB: tokenAddresses[ChainIds.BNB_TESTNET].weth,
                lowerPricePercentage: -200_000,
                upperPricePercentage: 100_000,
                percentage: 10,
            },
        ],
        buyInvestments: [
            {
                token: tokenAddresses[ChainIds.BNB_TESTNET].btcb,
                percentage: 10,
            },
            {
                token: tokenAddresses[ChainIds.BNB_TESTNET].weth,
                percentage: 10,
            },
        ],
    },
    {
        name: 'Crypto Liquidity',
        bio: 'This strategy is designed to provide liquidity to the crypto market. It is a simple strategy to understand and execute. It is suitable for beginners who want to invest in crypto but do not have the time or expertise to actively manage investments.',
        liquidityInvestments: [
            {
                tokenA: tokenAddresses[ChainIds.BNB_TESTNET].wbnb,
                tokenB: tokenAddresses[ChainIds.BNB_TESTNET].btcb,
                lowerPricePercentage: -100_000,
                upperPricePercentage: 300_000,
                percentage: 20,
            },
            {
                tokenA: tokenAddresses[ChainIds.BNB_TESTNET].wbnb,
                tokenB: tokenAddresses[ChainIds.BNB_TESTNET].weth,
                lowerPricePercentage: -100_000,
                upperPricePercentage: 300_000,
                percentage: 20,
            },
            {
                tokenA: tokenAddresses[ChainIds.BNB_TESTNET].btcb,
                tokenB: tokenAddresses[ChainIds.BNB_TESTNET].weth,
                lowerPricePercentage: -200_000,
                upperPricePercentage: 100_000,
                percentage: 60,
            },
        ],
    },
    {
        name: 'Buy N Hodl',
        bio: 'This strategy is designed to buy crypto and hold it for a long time. It is a simple strategy that is easy to understand and execute.',
        buyInvestments: [
            {
                token: tokenAddresses[ChainIds.BNB_TESTNET].btcb,
                percentage: 50,
            },
            {
                token: tokenAddresses[ChainIds.BNB_TESTNET].weth,
                percentage: 50,
            },
        ],
    },
]
