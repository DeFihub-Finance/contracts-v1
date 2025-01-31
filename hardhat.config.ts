import 'dotenv/config'
import '@openzeppelin/hardhat-upgrades'
import '@typechain/hardhat'
import '@nomicfoundation/hardhat-verify'
import '@nomicfoundation/hardhat-toolbox'
import '@nomicfoundation/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import 'hardhat-abi-exporter'
import 'hardhat-gas-reporter'
import 'tsconfig-paths/register'
import 'solidity-coverage'
import 'solidity-docgen'
import 'hardhat-contract-sizer'
import explorerKeys from './.explorer-keys.json'
import { HardhatUserConfig } from 'hardhat/config'
import { ChainIds, chainNameSchema, getNetworkConfig } from '@ryze-blockchain/ethereum'

const currentNetwork = process.env.HARDHAT_NETWORK
    ? getNetworkConfig(chainNameSchema.parse(process.env.HARDHAT_NETWORK), explorerKeys)
    : undefined
const accounts = process.env.PRIVATE_KEY
    ? [process.env.PRIVATE_KEY]
    : undefined

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: '0.8.26',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 800,
                    },
                },
            },
        ],
    },
    networks: {
        hardhat: {
            chainId: ChainIds.BNB_TESTNET,
        },
        ...(
            currentNetwork
                ? {
                    [currentNetwork.name]: {
                        ...currentNetwork,
                        gasMultiplier: 2,
                        accounts,
                    },
                }
                : {}
        ),
    },
    etherscan: {
        apiKey: currentNetwork?.explorer,
    },
    typechain: {
        outDir: 'src/typechain',
        externalArtifacts: ['./src/external-abis/*.json'],
    },
    abiExporter: {
        runOnCompile: true,
        clear: true,
        flat: true,
        spacing: 4,
        only: [
            'BuyProduct.sol',
            'DollarCostAverage.sol',
            'ICall.sol',
            'LiquidityManager.sol',
            'StrategyInvestor.sol',
            'StrategyPositionManager.sol',
            'StrategyManager.sol',
            'StrategyStorage.sol',
            'SubscriptionManager.sol',
            'SwapperUniswapV3.sol',
            'UseFee.sol',
            'VaultManager.sol',
            'ZapManager.sol',
            'ZapperUniswapV2.sol',
        ],
    },
    gasReporter: {
        enabled: true,
        currency: 'USD',
        gasPrice: 20,
        coinmarketcap: process.env.CMC_API_KEY,
    },
    docgen: {
        pages: 'files',
        exclude: [
            'test',
            'interfaces',
        ],
    },
}

export default config
