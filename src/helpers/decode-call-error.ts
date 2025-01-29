import type { ErrorDescription } from 'ethers'
import { decodeLowLevelCallError as _decodeLowLevelCallError } from '@defihub/shared'
import {
    StrategyManager__factory,
    StrategyPositionManager__factory,
    StrategyInvestor__factory,
    SubscriptionManager__factory,
    DollarCostAverage__factory,
    LiquidityManager__factory,
    VaultManager__factory,
    HubRouter__factory,
    UniversalRouter__factory,
} from '@src/typechain'

const contractInterfaces = [
    StrategyManager__factory.createInterface(),
    StrategyPositionManager__factory.createInterface(),
    StrategyInvestor__factory.createInterface(),
    SubscriptionManager__factory.createInterface(),
    DollarCostAverage__factory.createInterface(),
    VaultManager__factory.createInterface(),
    LiquidityManager__factory.createInterface(),
    HubRouter__factory.createInterface(),
    UniversalRouter__factory.createInterface(),
]

export function decodeLowLevelCallError(error: unknown): string | ErrorDescription | undefined {
    return _decodeLowLevelCallError(error, contractInterfaces)
}
