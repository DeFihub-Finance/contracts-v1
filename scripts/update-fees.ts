import { proposeTransactions } from '@src/helpers/safe'
import { UseFee__factory } from '@src/typechain'
import { getChainId, getSigner } from '@src/helpers'
import { getAddressOrFail } from '@defihub/shared'

async function updateFees() {
    const chainId = await getChainId()
    const deployer = await getSigner()

    const dca = UseFee__factory.connect(getAddressOrFail(chainId, 'DollarCostAverage'), deployer)
    const liquidity = UseFee__factory.connect(getAddressOrFail(chainId, 'LiquidityManager'), deployer)
    const buy = UseFee__factory.connect(getAddressOrFail(chainId, 'BuyProduct'), deployer)

    await proposeTransactions(chainId, [
        await dca.setFee.populateTransaction(60n, 30n),
        await liquidity.setFee.populateTransaction(70n, 30n),
        await buy.setFee.populateTransaction(40n, 30n),
    ])
}

updateFees()
