import { FeeToType } from '@src/constants'
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
    feeTo: FeeToType,
) {
    const contractInterface = StrategyInvestor__factory.createInterface()

    if (receipt?.logs) {
        for (const log of receipt.logs) {
            const parsedLog = contractInterface.parseLog(log)

            if (parsedLog && parsedLog.name === 'Fee') {
                const [
                    _,
                    feeToBI,
                ] = AbiCoder.defaultAbiCoder()
                    .decode(['uint', 'uint8'], parsedLog.args[3])

                if (feeToBI === feeTo)
                    return parsedLog
            }
        }
    }
}
