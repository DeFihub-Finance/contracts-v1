import { findAddressOrFail, sendTransaction } from '@src/helpers'
import { DollarCostAverage__factory } from '@src/typechain'
import hre from 'hardhat'

async function swap() {
    const [deployer] = await hre.ethers.getSigners()
    const dca = DollarCostAverage__factory.connect(
        await findAddressOrFail('DollarCostAverage'),
        deployer,
    )

    try {
        await sendTransaction(
            await dca.swap.populateTransaction(
                [3,4,5].map(poolId => ({
                    poolId,
                    minOutputAmount: 0,
                })),
            ),
            deployer,
        )
    }
    catch (e) {
        console.log('err', dca.interface.parseError((e as { data: string }).data))
    }
}

swap()
