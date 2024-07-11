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
        exchangeManager: UseFee,
    ) {
        const [
            isHottestDeal,
            {
                dcaInvestments,
                vaultInvestments,
                liquidityInvestments,
                tokenInvestments,
            },
        ] = await Promise.all([
            strategyManager.isHot(strategyId),
            strategyManager.getStrategyInvestments(strategyId),
        ])

        const dcaPercentage = Fees._sumInvestmentPercentages(dcaInvestments)
        const vaultPercentage = Fees._sumInvestmentPercentages(vaultInvestments)
        const liquidityPercentage = Fees._sumInvestmentPercentages(liquidityInvestments)
        const tokensPercentage = Fees._sumInvestmentPercentages(tokenInvestments)

        const [
            strategistPercentage,
            { baseFeeBP: dcaBaseFeeBP, nonSubscriberFeeBP: dcaNonSubscriberFeeBP },
            { baseFeeBP: vaultBaseFeeBP, nonSubscriberFeeBP: vaultNonSubscriberFeeBP },
            { baseFeeBP: liquidityBaseFeeBP, nonSubscriberFeeBP: liquidityNonSubscriberFeeBP },
            { baseFeeBP: exchangeBaseFeeBP, nonSubscriberFeeBP: exchangeNonSubscriberFeeBP },
        ] = await Promise.all([
            isHottestDeal
                ? strategyManager.hotStrategistPercentage()
                : strategyManager.strategistPercentage(),
            Fees._getProductFees(dca, subscribedUser),
            Fees._getProductFees(vaultManager, subscribedUser),
            Fees._getProductFees(liquidityManager, subscribedUser),
            Fees._getProductFees(exchangeManager, subscribedUser),
        ])

        const baseFee = new BigNumber(
            (
                dcaBaseFeeBP * dcaPercentage +
                vaultBaseFeeBP * vaultPercentage +
                liquidityBaseFeeBP * liquidityPercentage +
                exchangeBaseFeeBP * tokensPercentage
            ).toString(),
        ).div(10_000)
        const nonSubscriberFee = new BigNumber(
            (
                dcaNonSubscriberFeeBP * dcaPercentage +
                vaultNonSubscriberFeeBP * vaultPercentage +
                liquidityNonSubscriberFeeBP * liquidityPercentage +
                exchangeNonSubscriberFeeBP * tokensPercentage
            ).toString(),
        ).div(10_000)
        const strategistFee = baseFee.times(strategistPercentage.toString()).div(100)

        return {
            protocolFee: baseFee.minus(strategistFee),
            nonSubscriberFee,
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
        exchangeManager: UseFee,
    ) {
        const {
            protocolFee,
            nonSubscriberFee,
            strategistFee,
        } = await Fees.getStrategyFeePercentage(
            strategyManager,
            strategyId,
            subscribedUser,
            dca,
            vaultManager,
            liquidityManager,
            exchangeManager,
        )
        const amountBN = new BigNumber(amount.toString())

        return {
            protocolFee: BigInt(amountBN.times(protocolFee.plus(nonSubscriberFee).div(100)).toString()),
            strategistFee: BigInt(amountBN.times(strategistFee.div(100)).toString()),
        }
    }

    public static async deductProductFee(
        amount: bigint,
        subscribedUser: boolean,
        product: UseFee,
    ) {
        const [
            baseFeeBP,
            nonSubscriberFeeBP,
        ] = await Promise.all([
            product.baseFeeBP(),
            subscribedUser ? BigInt(0) : product.nonSubscriberFeeBP(),
        ])

        return amount - (amount * (baseFeeBP + nonSubscriberFeeBP) / BigInt(10_000))
    }

    public static async deductStrategyFee(
        amount: bigint,
        strategyManager: StrategyManager,
        strategyId: BigNumberish,
        subscribedUser: boolean,
        dca: UseFee,
        vaultManager: UseFee,
        liquidityManager: UseFee,
        exchangeManager: UseFee,
    ) {
        const { protocolFee, strategistFee } = await Fees.getStrategyFeeAmount(
            amount,
            strategyManager,
            strategyId,
            subscribedUser,
            dca,
            vaultManager,
            liquidityManager,
            exchangeManager,
        )

        return amount - protocolFee - strategistFee
    }

    private static _sumInvestmentPercentages(product: { percentage: bigint }[]) {
        return product.reduce(
            (acc, curr) => acc + curr.percentage,
            BigInt(0),
        )
    }

    private static async _getProductFees(product: UseFee, subscribedUser: boolean) {
        const [
            baseFeeBP,
            nonSubscriberFeeBP,
        ] = await Promise.all([
            product.baseFeeBP(),
            subscribedUser ? BigInt(0) : product.nonSubscriberFeeBP(),
        ])

        return {
            baseFeeBP,
            nonSubscriberFeeBP,
        }
    }
}
