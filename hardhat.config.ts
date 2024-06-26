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
                        runs: 1600,
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
    },
    gasReporter: {
        enabled: true,
        currency: 'USD',
        gasPrice: 20,
        coinmarketcap: process.env.CMC_API_KEY,
    },
}

export default config
