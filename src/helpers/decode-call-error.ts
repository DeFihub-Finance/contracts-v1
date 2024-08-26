import type { ErrorDescription } from 'ethers'
import { decodeLowLevelCallError as _decodeLowLevelCallError } from '@defihub/shared'
import {
    DollarCostAverage__factory,
    StrategyInvestor__factory,
    LiquidityManager__factory,
    StrategyManager__factory,
    StrategyPositionManager__factory,
    SubscriptionManager__factory,
    VaultManager__factory,
    ZapManager__factory,
} from '@src/typechain'

const contractInterfaces = [
    SubscriptionManager__factory.createInterface(),
    StrategyManager__factory.createInterface(),
    StrategyPositionManager__factory.createInterface(),
    DollarCostAverage__factory.createInterface(),
    VaultManager__factory.createInterface(),
    ZapManager__factory.createInterface(),
    StrategyInvestor__factory.createInterface(),
    LiquidityManager__factory.createInterface(),
]

export function decodeLowLevelCallError(error: unknown): string | ErrorDescription | undefined {
    return _decodeLowLevelCallError(error, contractInterfaces)
}
