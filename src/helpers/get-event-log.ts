import { FeeToType } from '@defihub/shared'
import { StrategyInvestor__factory } from '@src/typechain'
import { AbiCoder, ContractTransactionReceipt, Interface } from 'ethers'

export function getEventLog(
    receipt: ContractTransactionReceipt | null,
    eventName: string,
    contractInterface: Interface,
) {
    if (receipt?.logs) {
        for (const log of receipt.logs) {
            const parsedLog = contractInterface.parseLog(log)

            if (parsedLog && parsedLog.name === eventName)
                return parsedLog
        }
    }
}

export function getFeeEventLog(
    receipt: ContractTransactionReceipt | null,
    expectedFeeTo: FeeToType,
) {
    const contractInterface = StrategyInvestor__factory.createInterface()

    if (receipt?.logs) {
        for (const log of receipt.logs) {
            const parsedLog = contractInterface.parseLog(log)

            if (parsedLog && parsedLog.name === 'Fee') {
                const [
                    _strategyId,
                    _tokenAddress,
                    resultingFeeTo,
                ] = AbiCoder.defaultAbiCoder().decode(
                    ['uint', 'address', 'uint8', 'uint8'],
                    parsedLog.args[3],
                )

                if (resultingFeeTo === BigInt(expectedFeeTo))
                    return parsedLog
            }
        }
    }
}
