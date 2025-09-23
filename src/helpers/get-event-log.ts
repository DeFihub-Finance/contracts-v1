import { FeeToType } from '@defihub/shared'
import { notEmpty } from '@ryze-blockchain/ethereum'
import { StrategyInvestor__factory } from '@src/typechain'
import { ContractTransactionReceipt, Interface } from 'ethers'
import { decodeFeeEventBytes } from './test-helpers'

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
                ] = decodeFeeEventBytes(parsedLog.args[3])

                if (resultingFeeTo === BigInt(expectedFeeTo))
                    return parsedLog
            }
        }
    }
}

export function getAllFeeEventLogs(receipt: ContractTransactionReceipt | null) {
    const contractInterface = StrategyInvestor__factory.createInterface()

    if (receipt?.logs) {
        return receipt.logs.map(log => {
            const parsedLog = contractInterface.parseLog(log)

            return parsedLog && parsedLog.name === 'Fee' ? parsedLog : null
        }).filter(notEmpty)
    }
}
