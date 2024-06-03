import { findAddressOrFail, sendTransaction } from '@src/helpers'
import { DollarCostAverage__factory } from '@src/typechain'
import { parseUnits, ZeroHash } from 'ethers'
import hre from 'hardhat'

const poolId = 0
const amount = '10000'

async function deposit() {
    const [deployer] = await hre.ethers.getSigners()
    const dca = DollarCostAverage__factory.connect(
        await findAddressOrFail('DollarCostAverage'),
        deployer,
    )

    await sendTransaction(
        await dca.deposit.populateTransaction(
            poolId,
            30,
            parseUnits(amount, 18),
            {
                deadline: 0,
                v: 0,
                r: ZeroHash,
                s: ZeroHash,
            },
        ),
        deployer,
    )
}

deposit()
