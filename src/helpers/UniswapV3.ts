import { Pool, Position } from '@uniswap/v3-sdk'
import { Percent, Token } from '@uniswap/sdk-core'
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
    UniswapPositionManager,
    UniswapV3Factory,
    UniswapV3Pool__factory,
    type UniswapV3Pool,
} from '@src/typechain'
import { NetworkService } from '@src/NetworkService'
import { PathUniswapV3 } from '@defihub/shared'
import { ethers } from 'hardhat'

type UniswapV3Position = {
    liquidity: bigint
    tickLower: bigint
    tickUpper: bigint
}

export class UniswapV3 {
    public static MAX_UINT_128 = 2n ** 128n - 1n

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
        ] = await Promise.all([
            pool.liquidity(),
            pool.slot0(),
        ])

        return new Pool(
            new Token(ChainIds.ETH, tokenA, 18),
            new Token(ChainIds.ETH, tokenB, 18),
            Number(fee),
            sqrtPriceX96.toString(),
            liquidity.toString(),
            Number(tick),
        )
    }

    // TODO move to shared
    public static getPositionTokenAmounts(
        pool: Pool,
        { liquidity, tickLower, tickUpper }: UniswapV3Position,
    ) {
        const { amount0, amount1 } = new Position({
            pool,
            liquidity: liquidity.toString(),
            tickLower: Number(tickLower),
            tickUpper: Number(tickUpper),
        })

        return {
            amount0: BigInt(amount0.quotient.toString()),
            amount1: BigInt(amount1.quotient.toString()),
        }
    }

    public static getPositionFees(
        tokenId: bigint,
        positionManager: UniswapPositionManager,
        from?: AddressLike,
    ) {
        return positionManager.connect(ethers.provider).collect.staticCall({
            tokenId,
            recipient: ZeroAddress,
            amount0Max: UniswapV3.MAX_UINT_128,
            amount1Max: UniswapV3.MAX_UINT_128,
        }, { from })
    }

    public static getBurnAmounts(
        pool: Pool,
        position: UniswapV3Position,
        slippage: BigNumber = new BigNumber(0.01), // 1%
    ) {
        const { amount0, amount1 } = new Position({
            pool,
            liquidity: position.liquidity.toString(),
            tickLower: Number(position.tickLower),
            tickUpper: Number(position.tickUpper),
        })
            .burnAmountsWithSlippage(new Percent(slippage.times(100).toString(), 100))

        return {
            minOutputToken0: BigInt(amount0.toString()),
            minOutputToken1: BigInt(amount1.toString()),
        }
    }
}
