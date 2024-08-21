import { StrategyManager, SubscriptionManager } from '@src/typechain'
import { Signer, ZeroHash } from 'ethers'

export async function createStrategy(
    strategist: Signer,
    permit: SubscriptionManager.PermitStruct,
    strategyManager: StrategyManager,
    {
        dcaInvestments,
        vaultInvestments,
        liquidityInvestments,
        buyInvestments,
    }: Omit<StrategyManager.CreateStrategyParamsStruct, 'permit' | 'metadataHash'>,
): Promise<bigint> {
    const strategyId = await strategyManager.getStrategiesLength()

    await strategyManager.connect(strategist).createStrategy({
        dcaInvestments,
        vaultInvestments,
        liquidityInvestments,
        buyInvestments,
        permit,
        metadataHash: ZeroHash,
    })

    return strategyId
}
