import { deployImplementation, findAddressOrFail } from '@src/helpers'
import { upgrade } from '@src/helpers/upgrade'
import { StrategyInvestor__factory, StrategyManager__v2__factory, StrategyPositionManager__factory } from '@src/typechain'

async function upgradeToV2() {
    const strategyInvestor = await deployImplementation(
        'StrategyInvestor',
        StrategyInvestor__factory.bytecode,
    )
    const strategyPositionManager = await deployImplementation(
        'StrategyPositionManager',
        StrategyPositionManager__factory.bytecode,
    )

    console.log({
        strategyInvestor,
        strategyPositionManager,
    })

    await upgrade(
        await findAddressOrFail('StrategyManager'),
        'StrategyManager__v2',
        StrategyManager__v2__factory
            .createInterface()
            .encodeFunctionData(
                'initialize__v2',
                [
                    strategyInvestor,
                    strategyPositionManager,
                    10n,
                ],
            ),
    )

    await upgrade(
        await findAddressOrFail('LiquidityManager'),
        'LiquidityManager',
    )
}

upgradeToV2()
