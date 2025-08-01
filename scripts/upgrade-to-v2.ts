import { deployImplementation, findAddressOrFail, upgradeMany } from '@src/helpers'
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

    await upgradeMany([
        {
            proxyAddress: await findAddressOrFail('StrategyManager'),
            newImplementationName: 'StrategyManager__v2',
            calldata: StrategyManager__v2__factory
                .createInterface()
                .encodeFunctionData(
                    'initialize__v2',
                    [
                        strategyInvestor,
                        strategyPositionManager,
                        10n,
                    ],
                ),
        },
        {
            proxyAddress: await findAddressOrFail('LiquidityManager'),
            newImplementationName: 'LiquidityManager',
        },
    ])
}

upgradeToV2()
