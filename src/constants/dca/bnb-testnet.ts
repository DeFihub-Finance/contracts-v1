import { tokens } from '../tokens'
import { ChainIds } from '@ryze-blockchain/ethereum'

const bnbTestnetDcaPools = [
    {
        inputToken: tokens[ChainIds.BNB_TESTNET].usdt,
        outputToken: tokens[ChainIds.BNB_TESTNET].wbtc,
    },
    {
        inputToken: tokens[ChainIds.BNB_TESTNET].usdt,
        outputToken: tokens[ChainIds.BNB_TESTNET].weth,
    },
    {
        inputToken: tokens[ChainIds.BNB_TESTNET].usdt,
        outputToken: tokens[ChainIds.BNB_TESTNET].wbnb,
    },
    {
        inputToken: tokens[ChainIds.BNB_TESTNET].wbtc,
        outputToken: tokens[ChainIds.BNB_TESTNET].usdt,
    },
    {
        inputToken: tokens[ChainIds.BNB_TESTNET].weth,
        outputToken: tokens[ChainIds.BNB_TESTNET].usdt,
    },
    {
        inputToken: tokens[ChainIds.BNB_TESTNET].wbnb,
        outputToken: tokens[ChainIds.BNB_TESTNET].usdt,
    },
]
