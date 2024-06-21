import { BigNumberish } from 'ethers'
import { StrategyManager, UseFee } from '@src/typechain'
import { BigNumber } from '@ryze-blockchain/ethereum'

// TODO move to shared
export class Fees {
    public static async getStrategyFeePercentage(
        strategyManager: StrategyManager,
        strategyId: BigNumberish,
        subscribedUser: boolean,
        dca: UseFee,
        vaultManager: UseFee,
        liquidityManager: UseFee,
    ) {
        const [
            isHottestDeal, {
                dcaInvestments,
                vaultInvestments,
                liquidityInvestments,
            },
        ] = await Promise.all([
            strategyManager.isHot(strategyId),
            strategyManager.getStrategyInvestments(strategyId),
        ])

        const dcaPercentage = dcaInvestments.reduce(
            (acc, investment) => acc + investment.percentage,
            BigInt(0),
        )
        const vaultPercentage = vaultInvestments.reduce(
            (acc, investment) => acc + investment.percentage,
            BigInt(0),
        )
        const liquidityPercentage = liquidityInvestments.reduce(
            (acc, investment) => acc + investment.percentage,
            BigInt(0),
        )

        const [
            strategistPercentage,
            dcaBaseFeeBP,
            vaultBaseFeeBP,
            liquidityBaseFeeBP,
            dcaNonSubscriberFeeBP,
            vaultNonSubscriberFeeBP,
            liquidityNonSubscriberFeeBP,
        ] = await Promise.all([
            isHottestDeal
                ? strategyManager.hotStrategistPercentage()
                : strategyManager.strategistPercentage(),
            dca.baseFeeBP(),
            vaultManager.baseFeeBP(),
            liquidityManager.baseFeeBP(),
            subscribedUser ? BigInt(0) : dca.nonSubscriberFeeBP(),
            subscribedUser ? BigInt(0) : vaultManager.nonSubscriberFeeBP(),
            subscribedUser ? BigInt(0) : liquidityManager.nonSubscriberFeeBP(),
        ])

        const baseFee = new BigNumber(
            (
                dcaBaseFeeBP * dcaPercentage +
                vaultBaseFeeBP * vaultPercentage +
                liquidityBaseFeeBP * liquidityPercentage
            ).toString(),
        ).div(10_000)
        const nonSubscriberFee = new BigNumber(
            (
                dcaNonSubscriberFeeBP * dcaPercentage +
                vaultNonSubscriberFeeBP * vaultPercentage +
                liquidityNonSubscriberFeeBP * liquidityPercentage
            ).toString(),
        ).div(10_000)
        const strategistFee = baseFee.times(strategistPercentage.toString()).div(100)

        return {
            protocolFee: baseFee.minus(strategistFee).plus(nonSubscriberFee),
            strategistFee,
        }
    }

    public static async getStrategyFeeAmount(
        amount: bigint,
        strategyManager: StrategyManager,
        strategyId: BigNumberish,
        subscribedUser: boolean,
        dca: UseFee,
        vaultManager: UseFee,
        liquidityManager: UseFee,
    ) {
        const {
            protocolFee,
            strategistFee,
        } = await this.getStrategyFeePercentage(
            strategyManager,
            strategyId,
            subscribedUser,
            dca,
            vaultManager,
            liquidityManager,
        )
        const amountBN = new BigNumber(amount.toString())

        return {
            protocolFee: BigInt(amountBN.times(protocolFee.div(100)).toString()),
            strategistFee: BigInt(amountBN.times(strategistFee.div(100)).toString()),
        }
    }

    public static async deductStrategyFee(
        amount: bigint,
        strategyManager: StrategyManager,
        strategyId: BigNumberish,
        subscribedUser: boolean,
        dca: UseFee,
        vaultManager: UseFee,
        liquidityManager: UseFee,
    ) {
        const { protocolFee , strategistFee } = await this.getStrategyFeeAmount(
            amount,
            strategyManager,
            strategyId,
            subscribedUser,
            dca,
            vaultManager,
            liquidityManager,
        )

        return amount - protocolFee - strategistFee
    }
}
