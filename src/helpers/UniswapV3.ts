import { BigNumber } from '@ryze-blockchain/ethereum'
import {
    Signer,
    MaxUint256,
    ZeroAddress,
    AddressLike,
} from 'ethers'
import {
    INonfungiblePositionManager,
    Quoter,
    TestERC20,
    TestERC20__factory,
    UniswapV3Factory,
    UniswapV3Pool__factory,
    type UniswapV3Pool,
} from '@src/typechain'
import { NetworkService } from '@src/NetworkService'
import { PathUniswapV3, Pool } from '@defihub/shared'
import { ethers } from 'hardhat'
import { mockToken } from './mock-token'

export class UniswapV3 {
    public static async getOutputTokenAmount(
        quoter: Quoter,
        inputToken: AddressLike,
        outputToken: AddressLike,
        poolFee: bigint,
        amountIn: bigint,
    ) {
        const path = new PathUniswapV3(inputToken, [{ fee: poolFee, token: outputToken }])

        return quoter.quoteExactInput.staticCall(await path.encodedPath(), amountIn)
    }

    public static calculateSqrtPriceX96(
        price0: BigNumber,
        price1: BigNumber,
        decimals0 = 18,
        decimals1 = 18,
    ): bigint {
        // Clone and config BigNumber's for this specific function to improve precision.
        const bn = BigNumber.clone()

        bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

        const priceAdjusted = new bn(price0)
            .div(price1)
            .shiftedBy(decimals1 - decimals0)

        return BigInt(
            priceAdjusted
                .sqrt()
                .times(new bn(2).pow(96))
                .integerValue(BigNumber.ROUND_FLOOR)
                .toFixed(0),
        )
    }

    public static async mintAndAddLiquidity(
        factory: UniswapV3Factory,
        positionManager: INonfungiblePositionManager,
        tokenA: TestERC20,
        tokenB: TestERC20,
        amountA: bigint,
        amountB: bigint,
        priceA: BigNumber,
        priceB: BigNumber,
        to: Signer,
    ) {
        await tokenA.mint(to, amountA)
        await tokenB.mint(to, amountB)

        await tokenA.connect(to).approve(positionManager, MaxUint256)
        await tokenB.connect(to).approve(positionManager, MaxUint256)

        const deadline = await NetworkService.getBlockTimestamp() + 10_000
        const addressA = await tokenA.getAddress()
        const addressB = await tokenB.getAddress()

        const { token0, token1 } = UniswapV3.sortTokens(addressA, addressB)
        const tokenAIsToken0 = addressA === token0

        if (await factory.getPool(token0, token1, 3000) === ZeroAddress) {
            const decimalsA = Number(await tokenA.decimals())
            const decimalsB = Number(await tokenB.decimals())

            await positionManager.createAndInitializePoolIfNecessary(
                token0,
                token1,
                3000,
                UniswapV3.calculateSqrtPriceX96(
                    tokenAIsToken0 ? priceA : priceB,
                    tokenAIsToken0 ? priceB : priceA,
                    tokenAIsToken0 ? decimalsA : decimalsB,
                    tokenAIsToken0 ? decimalsB : decimalsA,
                ),
            )
        }

        return positionManager.connect(to).mint({
            token0,
            token1,
            amount0Desired: tokenAIsToken0 ? amountA : amountB,
            amount1Desired: tokenAIsToken0 ? amountB : amountA,
            amount0Min: 0,
            amount1Min: 0,
            recipient: to,
            fee: 3000,
            tickLower: -887220,
            tickUpper: 887220,
            deadline,
        })
    }

    public static sortTokens(tokenA: string, tokenB: string) {
        return tokenA.toLowerCase() < tokenB.toLowerCase()
            ? { token0: tokenA, token1: tokenB }
            : { token0: tokenB, token1: tokenA }
    }

    public static async getPoolByContract(contract: UniswapV3Pool) {
        const [
            token0,
            token1,
            liquidity,
            { sqrtPriceX96, tick },
        ] = await Promise.all([
            contract.token0(),
            contract.token1(),
            contract.liquidity(),
            contract.slot0(),
        ])

        const [
            token0Decimals,
            token1Decimals,
        ] = await Promise.all([
            TestERC20__factory.connect(token0, ethers.provider).decimals(),
            TestERC20__factory.connect(token1, ethers.provider).decimals(),
        ]).then(values => values.map(Number))

        return new Pool(
            mockToken(new BigNumber(1), token0Decimals, token0), // Price dont matter
            mockToken(new BigNumber(1), token1Decimals, token1),
            new BigNumber(0.003), // 0.3% fee
            sqrtPriceX96,
            liquidity,
            tick,
        )
    }

    public static async getPoolByFactoryContract(
        factory: UniswapV3Factory,
        tokenA: string,
        tokenB: string,
        fee: bigint,
    ) {
        const pool = UniswapV3Pool__factory.connect(
            await factory.getPool(tokenA, tokenB, fee),
            ethers.provider,
        )

        const [
            liquidity,
            { sqrtPriceX96, tick },
            decimalsTokenA,
            decimalsTokenB,
        ] = await Promise.all([
            pool.liquidity(),
            pool.slot0(),
            TestERC20__factory.connect(tokenA, ethers.provider).decimals(),
            TestERC20__factory.connect(tokenB, ethers.provider).decimals(),
        ])

        return new Pool(
            mockToken(new BigNumber(1), Number(decimalsTokenA), tokenA), // Price dont matter
            mockToken(new BigNumber(1), Number(decimalsTokenB), tokenB),
            new BigNumber(fee.toString()).shiftedBy(-6),
            sqrtPriceX96,
            liquidity,
            tick,
        )
    }
}
