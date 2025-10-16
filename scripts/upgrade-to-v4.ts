import { deployImplementation, findAddressOrFail, upgrade } from '@src/helpers'
import { StrategyManager__v4__factory, StrategyPositionManager__factory } from '@src/typechain'

async function upgradeToV4() {
    const strategyPositionManager = await deployImplementation(
        'StrategyPositionManager',
        StrategyPositionManager__factory.bytecode,
        { saveAs: 'StrategyPositionManager__v2' },
    )

    await upgrade({
        proxyAddress: await findAddressOrFail('StrategyManager'),
        newImplementationName: 'StrategyManager__v4',
        calldata: StrategyManager__v4__factory
            .createInterface()
            .encodeFunctionData(
                'initialize__v4',
                [
                    strategyPositionManager,
                    75 * 1e6 / 100,
                ],
            ),
    })
}

upgradeToV4()
