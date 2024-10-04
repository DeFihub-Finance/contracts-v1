import { parseEther } from 'ethers'
import { baseStrategyManagerFixture } from './base.fixture'
import { UniswapV3 } from '@defihub/shared'
import { createStrategy } from '@src/helpers'
import { StrategyManager } from '@src/typechain'

export async function createStrategyFixture() {
    /////////////////////////////////////
    // Initializing contracts and EOA //
    ///////////////////////////////////
    const {
        account0,
        account1,
        account2,
        stablecoin,
        anotherToken,
        strategyManager,
        dcaStrategyPositions,
        vaultStrategyPosition,
        positionManagerUniV3,
        subscriptionSignature,
        permitAccount0,
        vault,
        stablecoinPriced,
        wethPriced,
        ...rest
    } = await baseStrategyManagerFixture()

    await strategyManager.setHotStrategistPercentage(30)

    //////////////////////////////////////////////
    // Approve StrategyManager to spend tokens //
    /////////////////////////////////////////////
    await Promise.all([
        stablecoin.mint(account1, parseEther('1000')),
        stablecoin.mint(account2, parseEther('1000')),
        stablecoin.connect(account1).approve(strategyManager, parseEther('1000')),
        stablecoin.connect(account2).approve(strategyManager, parseEther('1000')),
        anotherToken.connect(account1).mint(account1, parseEther('1000')),
        anotherToken.connect(account1).approve(strategyManager, parseEther('1000')),
    ])

    /////////////////////////////////////////
    // Create default strategy for tests  //
    ////////////////////////////////////////
    const { token0, token1 } = UniswapV3.sortTokens(stablecoinPriced, wethPriced)

    const investments: Omit<StrategyManager.CreateStrategyParamsStruct, 'permit' | 'metadataHash'> = {
        dcaInvestments: [
            { poolId: 0, swaps: 10, percentage: 25 },
            { poolId: 1, swaps: 10, percentage: 25 },
        ],
        vaultInvestments: [
            {
                vault: await vault.getAddress(),
                percentage: 25,
            },
        ],
        liquidityInvestments: [
            {
                positionManager: positionManagerUniV3,
                token0: token0.address,
                token1: token1.address,
                fee: 3000,
                lowerPricePercentage: -100_000, // 10%
                upperPricePercentage: 100_000, // 10%
                percentage: 25,
            },
        ],
        buyInvestments: [],
    }

    const strategyId = await createStrategy(
        account0,
        permitAccount0,
        strategyManager,
        investments,
    )

    return {
        account0,
        account1,
        account2,
        anotherToken,
        strategyManager,
        dcaStrategyPositions,
        vaultStrategyPosition,
        positionManagerUniV3,
        subscriptionSignature,
        stablecoin,
        permitAccount0,
        vault,
        stablecoinPriced,
        wethPriced,
        strategyId,
        ...rest,
    }
}
