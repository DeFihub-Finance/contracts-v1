import {
    DollarCostAverage__factory,
    ICall__factory,
    InvestmentLib__factory,
    StrategyManager__factory,
    SubscriptionManager__factory,
    VaultManager__factory,
    ZapManager__factory,
} from '@src/typechain'
import { notEmpty } from '@ryze-blockchain/ethereum'
import { toUtf8String } from 'ethers'

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
    public static decodeLowLevelCallError(error: unknown) {
        const callInterface = ICall__factory.createInterface()
        const typedError = error as { data?: string | null }

        if (typedError.data) {
            let parsedError: LowLevelCallError | null = null
            let nextData = typedError.data

            while (nextData) {
                const currentParsedError = callInterface.parseError(nextData) as unknown as LowLevelCallError

                if (!currentParsedError)
                    break

                parsedError = currentParsedError
                nextData = parsedError.args.revertData
            }

            const customError = [
                SubscriptionManager__factory.createInterface(),
                StrategyManager__factory.createInterface(),
                DollarCostAverage__factory.createInterface(),
                VaultManager__factory.createInterface(),
                ZapManager__factory.createInterface(),
                InvestmentLib__factory.createInterface(),
            ]
                .map(face => face.parseError(nextData))
                .filter(notEmpty)[0]

            if (customError)
                return customError

            try {
                // TODO test parsedError check when handling zap because it uses only string errors in univ3
                console.log('revd', parsedError.args.revertData)

                // Attempt to decode the revert reason from the error data
                return toUtf8String(`0x${ parsedError.args.revertData.slice(138) }`)
                    .replace(/\0/g, '')
            }
            catch (decodingError) {
                throw new Error(parsedError.args.revertData)
            }
        }
    }
}
