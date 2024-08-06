import { findAddressOrFail, sendTransaction, UniswapV3 } from '@src/helpers'
import { TestERC20__factory, UniswapPositionManager__factory } from '@src/typechain'
import { AddressLike, BigNumberish, MaxUint256, parseUnits } from 'ethers'
import hre from 'hardhat'
import { tokens } from '@src/constants'
import { ChainIds } from '@ryze-blockchain/ethereum'

const tokenA = tokens[ChainIds.BNB_TESTNET].usdt
const tokenB = tokens[ChainIds.BNB_TESTNET].wbtc
const ratioFromTokenAToTokenB = 70_000

async function mintAndApprove(
    token: string,
    amount: BigNumberish,
    spender: AddressLike,
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
    const timestamp = (await hre.ethers.provider.getBlock('latest'))?.timestamp

    if (!timestamp)
        throw new Error('add-liquidity: missing timestamp')

    const positionManager = UniswapPositionManager__factory.connect(
        await findAddressOrFail('UniswapPositionManagerV3'),
        deployer,
    )

    const [
        decimals0,
        decimals1,
    ] = await Promise.all([
        TestERC20__factory.connect(tokenA, deployer).decimals(),
        TestERC20__factory.connect(tokenB, deployer).decimals(),
    ])

    const tokenAIsToken0 = tokenA < tokenB
    const amountDesiredA = parseUnits('50000000', decimals0)
    const amountDesiredB = parseUnits('50000000', decimals1) / BigInt(ratioFromTokenAToTokenB)

    await mintAndApprove(tokenA, amountDesiredA, positionManager)
    await mintAndApprove(tokenB, amountDesiredB, positionManager)

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
