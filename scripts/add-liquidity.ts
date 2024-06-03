import { sendTransaction, UniswapV3 } from '@src/helpers'
import {
    TestERC20__factory,
    UniswapPositionManager__factory,
} from '@src/typechain'
import { BigNumberish, MaxUint256, parseUnits } from 'ethers'
import hre from 'hardhat'
import { Storage } from 'hardhat-vanity'

const tokenA = ''
const tokenB = ''
const ratioFromTokenAToTokenB = 2400

async function mintAndApprove(
    token: string,
    amount: BigNumberish,
    spender: string,
) {
    const [deployer] = await hre.ethers.getSigners()

    await sendTransaction(
        await TestERC20__factory.connect(token, deployer)
            .mint
            .populateTransaction(deployer.address, amount),
        deployer,
    )

    await sendTransaction(
        await TestERC20__factory.connect(token, deployer)
            .approve
            .populateTransaction(spender, MaxUint256),
        deployer,
    )
}

async function addLiquidity() {
    const [deployer] = await hre.ethers.getSigners()
    const positionManagerAddress = await Storage.findAddress('UniswapPositionManagerV3')
    const factoryAddress = await Storage.findAddress('UniswapFactoryV3')
    const timestamp = (await hre.ethers.provider.getBlock('latest'))?.timestamp

    if (!positionManagerAddress)
        throw new Error('add-liquidity: missing PositionManager address')

    if (!factoryAddress)
        throw new Error('add-liquidity: missing Factory address')

    if (!timestamp)
        throw new Error('add-liquidity: missing timestamp')

    const positionManager = UniswapPositionManager__factory.connect(
        positionManagerAddress,
        deployer,
    )

    const [decimals0, decimals1] = await Promise.all([
        TestERC20__factory.connect(tokenA, deployer).decimals(),
        TestERC20__factory.connect(tokenB, deployer).decimals(),
    ])

    const tokenAIsToken0 = tokenA < tokenB
    const amountDesiredA = parseUnits('50000000', decimals0)
    const amountDesiredB = parseUnits('50000000', decimals1) / BigInt(ratioFromTokenAToTokenB)

    await mintAndApprove(tokenA, amountDesiredA, positionManagerAddress)
    await mintAndApprove(tokenB, amountDesiredB, positionManagerAddress)

    await sendTransaction(
        await positionManager.createAndInitializePoolIfNecessary.populateTransaction(
            tokenAIsToken0 ? tokenA : tokenB,
            tokenAIsToken0 ? tokenB : tokenA,
            3000,
            UniswapV3.calculateSqrtPriceX96(
                tokenAIsToken0 ? 1 : ratioFromTokenAToTokenB,
                tokenAIsToken0 ? ratioFromTokenAToTokenB : 1,
            ),
        ),
        deployer,
    )

    await sendTransaction(
        await positionManager.mint.populateTransaction({
            token0: tokenAIsToken0 ? tokenA : tokenB,
            token1: tokenAIsToken0 ? tokenB : tokenA,
            fee: 3000,
            tickLower: -887220, // Specify according to your desired price range
            tickUpper: 887220, // Specify according to your desired price range
            amount0Desired: tokenAIsToken0 ? amountDesiredA : amountDesiredB,
            amount1Desired: tokenAIsToken0 ? amountDesiredB : amountDesiredA,
            amount0Min: 0,
            amount1Min: 0,
            recipient: deployer.address,
            deadline: timestamp + 60 * 10,
        }),
        deployer,
    )
}

addLiquidity()
