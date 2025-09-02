import { deployImplementation, findAddressOrFail, upgrade } from '@src/helpers'
import { StrategyInvestor__factory, StrategyManager__v3__factory } from '@src/typechain'
import { YEAR_IN_SECONDS } from '@src/constants'

async function upgradeToV3() {
    const strategyInvestor = await deployImplementation(
        'StrategyInvestor',
        StrategyInvestor__factory.bytecode,
        { saveAs: 'StrategyInvestor__v3' },
    )

    await upgrade({
        proxyAddress: await findAddressOrFail('StrategyManager'),
        newImplementationName: 'StrategyManager__v3',
        calldata: StrategyManager__v3__factory
            .createInterface()
            .encodeFunctionData(
                'initialize__v3',
                [
                    strategyInvestor,
                    YEAR_IN_SECONDS * 3,
                ],
            ),
    })
}

upgradeToV3()
