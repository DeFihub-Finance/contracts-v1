import { NetworkService } from '@src/NetworkService'
import { MaxUint256, Signer } from 'ethers'
import { TestERC20, UniswapV2Router02 } from '@src/typechain'

export class UniswapV2 {
    public static async mintAndAddLiquidity(
        router: UniswapV2Router02,
        tokenA: TestERC20,
        tokenB: TestERC20,
        amountA: bigint,
        amountB: bigint,
        to: Signer,
    ) {
        await tokenA.mint(to, amountA)
        await tokenB.mint(to, amountB)

        await tokenA.connect(to).approve(router, MaxUint256)
        await tokenB.connect(to).approve(router, MaxUint256)

        const deadline = await NetworkService.getBlockTimestamp() + 10_000

        return router.connect(to).addLiquidity(
            tokenA,
            tokenB,
            amountA,
            amountB,
            0,
            0,
            to,
            deadline,
        )
    }

    public static async estimateLiquidityOutput(
        amountA: bigint,
        amountB: bigint,
    ) {
        return UniswapV2.bigIntSqrt(amountA * amountB)
    }

    private static bigIntSqrt(value: bigint) {
        if (value < 0n)
            throw new Error('Square root of negative numbers is not defined')

        if (value < 2n)
            return value

        let x0: bigint = value / 2n
        let x1: bigint = (x0 + value / x0) / 2n

        // Use a loop that continues until the condition for updating x0 is met
        while (x0 !== x1 && x0 !== x1 - 1n) {
            x0 = x1
            x1 = (x0 + value / x0) / 2n
        }

        return x0
    }

}
