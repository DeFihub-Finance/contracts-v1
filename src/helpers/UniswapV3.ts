import { Pool } from '@uniswap/v3-sdk'
import { Token } from '@uniswap/sdk-core'
import { BigNumber, ChainIds } from '@ryze-blockchain/ethereum'
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
    UniswapV3Factory,
    type UniswapV3Pool,
} from '@src/typechain'
import { NetworkService } from '@src/NetworkService'
import { PathUniswapV3 } from '@defihub/shared'

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
        price0: number,
        price1: number,
        decimals0 = 18,
        decimals1 = 18,
    ): bigint {
        const priceRatio = new BigNumber(price0)
            .div(price1)
            .times(new BigNumber(10).pow(decimals0 - decimals1))

        // BigNumber.sqrt() calculates the square root, and we scale it by 2^96, adjusting for fixed-point representation
        const sqrtPrice = priceRatio.sqrt()
        const sqrtPriceX96 = sqrtPrice.times(new BigNumber(2).pow(96))

        return BigInt(sqrtPriceX96.toFixed(0))
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
            await positionManager.createAndInitializePoolIfNecessary(
                token0,
                token1,
                3000,
                UniswapV3.calculateSqrtPriceX96(
                    tokenAIsToken0 ? priceA.toNumber() : priceB.toNumber(),
                    tokenAIsToken0 ? priceB.toNumber() : priceA.toNumber(),
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

        return new Pool(
            new Token(ChainIds.ETH, token0, 18),
            new Token(ChainIds.ETH, token1, 18),
            3000,
            sqrtPriceX96.toString(),
            liquidity.toString(),
            Number(tick),
        )
    }

    public static getPriceRangeByPercentages(
        pool: Pool,
        lowerPricePercentage: number,
        upperPricePercentage: number,
    ) {
        const currentPrice = pool.token0Price.asFraction

        const lowerPrice = currentPrice.subtract(
            currentPrice.divide(lowerPricePercentage),
        ).toFixed(8)

        const upperPrice = currentPrice.add(
            currentPrice.divide(upperPricePercentage),
        ).toFixed(8)

        return { lowerPrice, upperPrice }
    }
}
