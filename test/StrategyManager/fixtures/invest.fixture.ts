import { createStrategyFixture } from './create-strategy.fixture'
import { parseEther } from 'ethers'
import { NetworkService } from '@src/NetworkService'
import { createStrategy, SwapEncoder } from '@src/helpers'
import { PathUniswapV3, UniswapV3 } from '@defihub/shared'
import { LiquidityHelpers } from '@src/helpers'
import { Fees } from '@src/helpers/Fees'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { ETH_PRICE_BN, USD_PRICE_BN } from '@src/constants'

export async function investFixture() {
    const amountToInvest = parseEther('30')
    const amountPerInvestmentStrategy = amountToInvest / 3n

    const {
        account0,
        account1,
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
        subscriptionSignature,
        stablecoin,
        stablecoinPriced,
        wethPriced,
        permitAccount0,
        factoryUniV3,
        positionManagerUniV3,
        universalRouter,
        ...rest
    } = await createStrategyFixture()
    const deadline = await NetworkService.getBlockTimestamp() + 10_000
    const permitAccount1 = await subscriptionSignature
        .signSubscriptionPermit(await account1.getAddress(), deadline)

    await Promise.all([
        stablecoin.mint(account1, amountToInvest),
        stablecoin.connect(account1).approve(strategyManager, amountToInvest),
    ])

    const { token0, token1 } = UniswapV3.sortTokens(stablecoinPriced, wethPriced)

    // Create strategies
    const dcaStrategyId = await createStrategy(
        account0,
        permitAccount0,
        strategyManager,
        {
            dcaInvestments: [
                { poolId: 0, swaps: 10, percentage: 50 },
                { poolId: 1, swaps: 10, percentage: 50 },
            ],
            vaultInvestments: [],
            liquidityInvestments: [],
            buyInvestments: [],
        },
    )
    const liquidityStrategyId = await createStrategy(
        account0,
        permitAccount0,
        strategyManager,
        {
            dcaInvestments: [],
            vaultInvestments: [],
            liquidityInvestments: [
                {
                    positionManager: positionManagerUniV3,
                    percentage: 100,
                    fee: 3000,
                    token0: token0.address,
                    token1: token1.address,
                    usePercentageBounds: true,
                    lowerBound: -100_000, // 10%
                    upperBound: 100_000, // 10%
                },
            ],
            buyInvestments: [],
        },
    )
    const buyOnlyStrategyId = await createStrategy(
        account0,
        permitAccount0,
        strategyManager,
        {
            dcaInvestments: [],
            vaultInvestments: [],
            liquidityInvestments: [],
            buyInvestments: [
                {
                    token: wethPriced.address,
                    percentage: 100,
                },
            ],
        },
    )

    const dcaPositionId = await strategyManager.getPositionsLength(account1)

    await strategyManager.connect(account1).invest({
        strategyId: dcaStrategyId,
        inputToken: stablecoin,
        inputAmount: amountPerInvestmentStrategy,
        inputTokenSwap: '0x',
        dcaSwaps: ['0x', '0x'],
        vaultSwaps: [],
        buySwaps: [],
        liquidityZaps: [],
        investorPermit: permitAccount1,
        strategistPermit: permitAccount0,
    })

    const { liquidityInvestments } = await strategyManager.getStrategyInvestments(liquidityStrategyId)
    const amountWithDeductedFees = await Fees.deductStrategyFee(
        amountPerInvestmentStrategy,
        strategyManager,
        liquidityStrategyId,
        true,
        true,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
    )
    const liquidityZaps = await Promise.all(liquidityInvestments.map(
        investment => LiquidityHelpers.getLiquidityZap(
            universalRouter,
            amountWithDeductedFees,
            investment,
            stablecoinPriced,
            token0,
            token1,
            factoryUniV3,
            liquidityManager,
        ),
    ))

    const liquidityPositionId = await strategyManager.getPositionsLength(account1)

    await strategyManager.connect(account1).invest({
        strategyId: liquidityStrategyId,
        inputToken: stablecoin,
        inputAmount: amountPerInvestmentStrategy,
        inputTokenSwap: '0x',
        dcaSwaps: [],
        vaultSwaps: [],
        buySwaps: [],
        liquidityZaps,
        investorPermit: permitAccount1,
        strategistPermit: permitAccount0,
    })

    const buyOnlyStrategyPositionId = await strategyManager.getPositionsLength(account1)

    await strategyManager.connect(account1).invest({
        strategyId: buyOnlyStrategyId,
        inputToken: stablecoin,
        inputAmount: amountPerInvestmentStrategy,
        inputTokenSwap: '0x',
        dcaSwaps: [],
        vaultSwaps: [],
        liquidityZaps: [],
        buySwaps: [
            await SwapEncoder.encodeExactInputV3(
                universalRouter,
                await Fees.deductStrategyFee(
                    amountPerInvestmentStrategy,
                    strategyManager,
                    buyOnlyStrategyId,
                    true,
                    true,
                    dca,
                    vaultManager,
                    liquidityManager,
                    buyProduct,
                ),
                new PathUniswapV3(stablecoinPriced.address, [{ token: wethPriced.address, fee: 3000 }]),
                { price: USD_PRICE_BN, decimals: 18 },
                { price: ETH_PRICE_BN, decimals: 18 },
                new BigNumber(0.01),
                strategyManager,
            ),
        ],
        investorPermit: permitAccount1,
        strategistPermit: permitAccount0,
    })

    return {
        account0,
        account1,
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
        dcaStrategyId,
        dcaPositionId,
        liquidityStrategyId,
        liquidityPositionId,
        buyOnlyStrategyId,
        buyOnlyStrategyPositionId,
        amountToInvest,
        stablecoin,
        stablecoinPriced,
        wethPriced,
        permitAccount0,
        factoryUniV3,
        positionManagerUniV3,
        ...rest,
    }
}
