import { BigNumberish } from 'ethers'
import { StrategyManager, UseFee } from '@src/typechain'
import { BigNumber } from '@ryze-blockchain/ethereum'

// TODO move to shared
export class Fees {
    public static readonly FEE_DECIMALS = 4

    public static async getStrategyFeePercentage(
        strategyManager: StrategyManager,
        strategyId: BigNumberish,
        subscribedUser: boolean,
        subscribedStrategist: boolean,
        dca: UseFee,
        vaultManager: UseFee,
        liquidityManager: UseFee,
        exchangeManager: UseFee,
    ) {
        const {
            dcaInvestments,
            vaultInvestments,
            liquidityInvestments,
            buyInvestments,
        } = await strategyManager.getStrategyInvestments(strategyId)

        const dcaPercentage = Fees._sumInvestmentPercentages(dcaInvestments)
        const vaultPercentage = Fees._sumInvestmentPercentages(vaultInvestments)
        const liquidityPercentage = Fees._sumInvestmentPercentages(liquidityInvestments)
        const buyPercentage = Fees._sumInvestmentPercentages(buyInvestments)

        const [
            strategistPercentage,
            { totalBaseFee, totalNonSubscriberFee },
        ] = await Promise.all([
            Fees._getStrategistPercentage(strategyManager, strategyId, subscribedStrategist),
            Fees._calculateProductsFees(
                subscribedUser,
                [
                    { product: dca, weight: dcaPercentage },
                    { product: vaultManager, weight: vaultPercentage },
                    { product: liquidityManager, weight: liquidityPercentage },
                    { product: exchangeManager, weight: buyPercentage },
                ],
            ),
        ])

        const strategistFee = totalBaseFee
            .times(strategistPercentage.toString())
            .div(100)

        return {
            protocolFee: totalBaseFee.plus(totalNonSubscriberFee).minus(strategistFee),
            strategistFee,
        }
    }

    public static async getStrategyFeeAmount(
        amount: bigint,
        strategyManager: StrategyManager,
        strategyId: BigNumberish,
        subscribedUser: boolean,
        subscribedStrategist: boolean,
        dca: UseFee,
        vaultManager: UseFee,
        liquidityManager: UseFee,
        exchangeManager: UseFee,
    ) {
        const {
            protocolFee,
            strategistFee,
        } = await Fees.getStrategyFeePercentage(
            strategyManager,
            strategyId,
            subscribedUser,
            subscribedStrategist,
            dca,
            vaultManager,
            liquidityManager,
            exchangeManager,
        )
        const amountBN = new BigNumber(amount.toString())

        return {
            protocolFee: BigInt(amountBN.times(protocolFee.div(100)).toString()),
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
        subscribedStrategist: boolean,
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
            subscribedStrategist,
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

    private static async _getStrategistPercentage(
        strategyManager: StrategyManager,
        strategyId: BigNumberish,
        subscribedStrategist: boolean,
    ) {
        if (!subscribedStrategist)
            return BigInt(0)

        const isHottestDeal = await strategyManager.isHot(strategyId)

        return isHottestDeal
            ? strategyManager.hotStrategistPercentage()
            : strategyManager.strategistPercentage()
    }

    private static async _calculateProductsFees(
        subscribedUser: boolean,
        weightedProducts: { product: UseFee, weight: bigint }[],
    ) {
        const feesWithWeights = await Promise.all(weightedProducts.map(
            async ({ product, weight }) => {
                const {
                    baseFeeBP,
                    nonSubscriberFeeBP,
                } = await Fees._getProductFees(product, subscribedUser)

                return {
                    baseFee: baseFeeBP * weight,
                    nonSubscriberFee: nonSubscriberFeeBP * weight,
                }
            },
        ))

        let totalBaseFee = new BigNumber(0)
        let totalNonSubscriberFee = new BigNumber(0)

        for (const { baseFee, nonSubscriberFee } of feesWithWeights) {
            totalBaseFee = totalBaseFee.plus(baseFee.toString())
            totalNonSubscriberFee = totalNonSubscriberFee.plus(nonSubscriberFee.toString())
        }

        return {
            totalBaseFee: totalBaseFee.shiftedBy(-Fees.FEE_DECIMALS),
            totalNonSubscriberFee: totalNonSubscriberFee.shiftedBy(-Fees.FEE_DECIMALS),
        }
    }
}
