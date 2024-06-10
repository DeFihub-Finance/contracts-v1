import {
    DollarCostAverage__factory,
    ICall__factory,
    InvestLib__factory,
    StrategyManager__factory,
    SubscriptionManager__factory,
    VaultManager__factory,
    ZapManager__factory,
} from '@src/typechain'
import { notEmpty } from '@ryze-blockchain/ethereum'
import { ErrorDescription } from 'ethers'

interface LowLevelCallError {
    args: {
        to: string
        inputData: string
        revertData: string
    }
}

export class ErrorDecoder {
    /**
     * Decodes a stack of low-level call errors and throws a human-readable error message
     *
     * @param error - The error to decode
     */
    public static decodeLowLevelCallError(error: unknown): ErrorDescription | string | undefined {
        const callInterface = ICall__factory.createInterface()
        const typedError = error as { data?: string | null }

        if (typedError.data) {
            let parsedError: ErrorDescription | null = null
            let nextData = typedError.data

            while (nextData) {
                parsedError = callInterface.parseError(nextData)

                // if error cannot be parsed by the ICall interface, it isn't an instance of LowLevelCallError, therefore we try parsing it with other contract interfaces
                if (!parsedError) {
                    const customError = [
                        SubscriptionManager__factory.createInterface(),
                        StrategyManager__factory.createInterface(),
                        DollarCostAverage__factory.createInterface(),
                        VaultManager__factory.createInterface(),
                        ZapManager__factory.createInterface(),
                        InvestLib__factory.createInterface(),
                    ]
                        .map(contractInterface => contractInterface.parseError(nextData))
                        .filter(notEmpty)[0]

                    if (customError)
                        return customError
                }

                nextData = (parsedError as unknown as LowLevelCallError).args.revertData
            }

            // returns error message if it's a string
            if (parsedError?.signature === 'Error(string)')
                return parsedError.args[0]
        }
    }
}
