import { ERC20Priced, Slippage } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'

export function getMinOutput(
    amount: bigint,
    inputToken: ERC20Priced,
    outputToken: ERC20Priced,
    slippage: BigNumber = new BigNumber(0.01),
) {
    if (outputToken.address === inputToken.address)
        return Slippage.deductSlippage(amount, slippage)

    return Slippage.getMinOutput(
        amount,
        inputToken,
        outputToken,
        slippage.times(2), // Mul by 2 since we first need to swap on liquidity investments.
    )
}
