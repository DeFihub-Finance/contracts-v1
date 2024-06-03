export class ContractFees {
    public static BASE_FEE = 70n // 0.7%
    public static NON_SUBSCRIBER_FEE = 30n // 0.3%
    public static STRATEGIST_FEE = 20n // 20% of base fee

    public static getBaseFee(amount: bigint): bigint {
        return amount * ContractFees.BASE_FEE / 10_000n
    }

    public static getNonSubscriberFee(amount: bigint): bigint {
        return amount * (ContractFees.NON_SUBSCRIBER_FEE + ContractFees.BASE_FEE) / 10_000n
    }

    public static discountBaseFee(amount: bigint): bigint {
        return ContractFees.discountFee(amount, ContractFees.BASE_FEE)
    }

    public static discountNonSubscriberFee(amount: bigint): bigint {
        return ContractFees.discountFee(amount, ContractFees.BASE_FEE + ContractFees.NON_SUBSCRIBER_FEE)
    }

    public static getStrategistFee(amount: bigint): bigint {
        return amount * ContractFees.STRATEGIST_FEE / 100n
    }

    private static discountFee(amount: bigint, fee: bigint): bigint {
        return amount - amount * fee / 10_000n
    }
}
