import { BigNumber } from '@ryze-blockchain/ethereum'
import { expect } from 'chai'

export class Compare {
    public static almostEqual({
        value,
        target,
        tolerance,
    }: {
        value: bigint
        target: bigint
        tolerance: bigint
    }) {
        const min = target - (target * tolerance)
        const max = target + (target * tolerance)

        expect(value).to.satisfy(
            (n: bigint) => min <= n && max >= n,
            `${ value } not in ${ tolerance } range of ${ target }`,
        )
    }

    // @param tolerance 10_000 = 100% | 100 = 1%
    public static almostEqualPercentage({
        value,
        target,
        tolerance,
    }: {
        value: bigint
        target: bigint
        tolerance: BigNumber
    }) {
        const offset = BigInt(tolerance.times(target.toString()).toFixed(0))
        const min = target - offset
        const max = target + offset

        expect(value).to.satisfy(
            (n: bigint) => min <= n && max >= n,
            `${ value } not between ${ min } and ${ max }`,
        )
    }
}
