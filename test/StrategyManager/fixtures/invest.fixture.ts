import { createStrategyFixture } from './create-strategy.fixture'
import { parseEther } from 'ethers'
import { NetworkService } from '@src/NetworkService'
import { createStrategy } from '@src/helpers'
import { UniswapV3 } from '@defihub/shared'
import { LiquidityHelpers } from '@src/helpers'
import { Fees } from '@src/helpers/Fees'

export async function investFixture() {
    const amountToInvest = parseEther('20')
    const halfAmount = amountToInvest / 2n

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
        ...rest
    } = await createStrategyFixture()
    const deadline = await NetworkService.getBlockTimestamp() + 10_000
    const permitAccount1 = await subscriptionSignature
        .signSubscriptionPermit(await account1.getAddress(), deadline)

    await Promise.all([
        stablecoin.mint(account1, amountToInvest),
        stablecoin.connect(account1).approve(strategyManager, amountToInvest),
    ])

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

    const { token0, token1 } = UniswapV3.sortTokens(stablecoinPriced, wethPriced)
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
                    token0: token0.address,
                    token1: token1.address,
                    fee: 3000,
                    lowerPricePercentage: 10,
                    upperPricePercentage: 10,
                    percentage: 100,
                },
            ],
            buyInvestments: [],
        },
    )

    const dcaPositionId = await strategyManager.getPositionsLength(account1)

    await strategyManager.connect(account1).invest({
        strategyId: dcaStrategyId,
        inputToken: stablecoin,
        inputAmount: halfAmount,
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
        halfAmount,
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
        inputAmount: halfAmount,
        inputTokenSwap: '0x',
        dcaSwaps: [],
        vaultSwaps: [],
        buySwaps: [],
        liquidityZaps,
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
        liquidityStrategyId,
        dcaPositionId,
        liquidityPositionId,
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
