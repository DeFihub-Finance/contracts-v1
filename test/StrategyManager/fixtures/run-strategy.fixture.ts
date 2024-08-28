import { investFixture } from './invest.fixture'
import { NetworkService } from '@src/NetworkService'

export async function runStrategy() {
    const {
        dca,
        swapper,
        weth,
        strategyManager,
        account1,
        ...rest
    } = await investFixture()

    await Promise.all([
        // Swap to generate rewards for DCA
        dca.connect(swapper).swap([
            {
                poolId: 0,
                minOutputAmount: 0,
            },
        ]),

        // Pass time to generate rewards for Vaults
        NetworkService.fastForwardChain(60 * 60 * 24 * 7),
    ])

    return {
        ...rest,
        dca,
        swapper,
        weth,
        dcaOutputToken: weth,
        account1,
        strategyManager,
    }
}
