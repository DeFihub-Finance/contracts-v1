import hre from 'hardhat'
import { TestERC20Named__factory } from '@src/typechain'
import { saveAddress, sendDeploymentTransaction, verify } from '@src/helpers'

interface Token {
    name: string
    symbol: string
    key: string
}

const tokens: Token[] = [
    {
        name: 'Thether USD',
        symbol: 'USDT',
        key: 'Stablecoin',
    },
    {
        name: 'Dai Stablecoin',
        symbol: 'DAI',
        key: 'Dai',
    },
    {
        name: 'Wrapped BNB',
        symbol: 'WBNB',
        key: 'WrappedBNB',
    },
    {
        name: 'USDC Stablecoin',
        symbol: 'USDC',
        key: 'Usdc',
    },
]

async function deployToken({ name, symbol, key }: Token) {
    const [deployer] = await hre.ethers.getSigners()

    const tokenAddress = await sendDeploymentTransaction(
        TestERC20Named__factory.bytecode + TestERC20Named__factory
            .createInterface()
            .encodeDeploy([name, symbol])
            .substring(2),
        deployer,
    )

    await saveAddress(key, tokenAddress)

    await verify(
        tokenAddress,
        [name, symbol],
        'contracts/test/ERC20.sol:TestERC20Named',
    )
}

async function deployTokens() {
    for (const token of tokens)
        await deployToken(token)
}

deployTokens()
