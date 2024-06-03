import { BigNumber } from '@ryze-blockchain/ethereum'

export class Slippage {
    public static getMinOutput(
        amount: bigint,
        inputPrice: BigNumber,
        outputPrice: BigNumber,
        slippage: BigNumber,
    ) {
        const amountBn = new BigNumber(amount.toString())

        return BigInt(
            amountBn.minus(amountBn.times(slippage))
                .div(outputPrice.div(inputPrice))
                .toFixed(0),
        )
    }
}
