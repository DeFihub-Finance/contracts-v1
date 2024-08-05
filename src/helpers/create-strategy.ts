import { StrategyManager, SubscriptionManager } from '@src/typechain'
import { Signer, ZeroHash } from 'ethers'

export async function createStrategy(
    strategiest: Signer,
    permit: SubscriptionManager.PermitStruct,
    strategyManager: StrategyManager,
    {
        dcaInvestments,
        vaultInvestments,
        liquidityInvestments,
        tokenInvestments,
    }: Omit<StrategyManager.CreateStrategyParamsStruct, 'permit' | 'metadataHash'>,
): Promise<bigint> {
    const strategyId = await strategyManager.getStrategiesLength()

    await strategyManager.connect(strategiest).createStrategy({
        dcaInvestments,
        vaultInvestments,
        liquidityInvestments,
        tokenInvestments,
        permit,
        metadataHash: ZeroHash,
    })

    return strategyId
}