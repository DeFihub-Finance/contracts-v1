import { StrategyManager, StrategyManager__v4, SubscriptionManager } from '@src/typechain'
import { BigNumberish, Signer, ZeroHash } from 'ethers'

export async function createStrategy(
    strategist: Signer,
    permit: SubscriptionManager.PermitStruct,
    strategyManager: StrategyManager__v4,
    {
        dcaInvestments,
        vaultInvestments,
        liquidityInvestments,
        buyInvestments,
    }: Omit<StrategyManager.CreateStrategyParamsStruct, 'permit' | 'metadataHash'>,
    liquidityRewardFeeBP?: BigNumberish,
): Promise<bigint> {
    const strategyId = await strategyManager.getStrategiesLength()

    await strategyManager.connect(strategist).createStrategyV2({
        dcaInvestments,
        vaultInvestments,
        liquidityInvestments,
        buyInvestments,
        permit,
        metadataHash: ZeroHash,
    }, liquidityRewardFeeBP ?? 0)

    return strategyId
}
