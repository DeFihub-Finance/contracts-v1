import { baseDcaFixture } from './base.fixture'
import { getBytes, ZeroHash } from 'ethers'

export const createDepositFixture = async () =>  {
    const baseFixtureResult = await baseDcaFixture()

    await baseFixtureResult.dca.connect(baseFixtureResult.account0).invest(
        baseFixtureResult.positionParams.poolId,
        baseFixtureResult.positionParams.swaps,
        baseFixtureResult.positionParams.depositAmount,
        {
            r: getBytes(ZeroHash),
            s: getBytes(ZeroHash),
            v: 0n,
            deadline: 0n,
        },
    )

    return {
        ...baseFixtureResult,
    }
}
