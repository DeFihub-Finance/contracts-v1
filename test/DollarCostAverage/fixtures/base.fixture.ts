import { parseEther } from 'ethers'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { PathUniswapV3 } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { UniswapV3 } from '@src/helpers'

export type PositionParams = {
    depositAmount: bigint
    swaps: bigint
    poolId: bigint
    positionId: bigint
}

export const baseDcaFixture = async () => {
    const POOL_FEE = 3000n
    const TWENTY_FOUR_HOURS_IN_SECONDS = 60 * 60 * 24
    const USD_PRICE_BN = new BigNumber(1)
    const ETH_PRICE = 10_000n
    const ETH_PRICE_BN = new BigNumber(ETH_PRICE.toString())
    const ONE_BILLION_ETH = parseEther('1000000000')
    const ONE_MILLION = parseEther('1000000')

    const {
        stablecoin,
        dca,
        weth,
        treasury,
        swapper,
        account0,
        account1,
        account2,
        routerUniV3,
        factoryUniV3,
        positionManagerUniV3,
        ...rest
    } = (await new ProjectDeployer().deployProjectFixture())

    await Promise.all([
        stablecoin.mint(account0, ONE_MILLION),
        stablecoin.connect(account0).approve(dca, ONE_MILLION),
        weth.mint(account0, ONE_MILLION),
        weth.connect(account0).approve(account0, ONE_MILLION),
    ])

    await UniswapV3.mintAndAddLiquidity(
        factoryUniV3,
        positionManagerUniV3,
        weth,
        stablecoin,
        ONE_BILLION_ETH / ETH_PRICE,
        ONE_BILLION_ETH,
        ETH_PRICE_BN,
        USD_PRICE_BN,
        account1,
    )

    const path = new PathUniswapV3(stablecoin, [{ token: weth, fee: POOL_FEE }])

    await dca.createPool(
        stablecoin,
        weth,
        routerUniV3,
        await path.encodedPath(),
        TWENTY_FOUR_HOURS_IN_SECONDS,
    )

    const positionParams: PositionParams = {
        depositAmount: BigInt(parseEther('1000')),
        swaps: 10n,
        poolId: 0n,
        positionId: 0n,
    }

    await Promise.all([account0, account1].map(async account => {
        await stablecoin.connect(account).approve(
            await dca.getAddress(),
            positionParams.depositAmount,
        )
    }))

    return {
        // Contracts
        dca,
        path,
        stablecoin,
        weth,
        routerUniV3,

        // Accounts
        treasury,
        swapper,
        account0,
        account1,
        account2,

        // Constants
        POOL_FEE,
        TWENTY_FOUR_HOURS_IN_SECONDS,
        positionParams,

        ...rest,
    }
}
