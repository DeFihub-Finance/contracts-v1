import { parseEther, parseUnits } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { UniswapV3 } from '@src/helpers'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { UniswapV3Pool__factory } from '@src/typechain'

export async function uniswapV3Fixture() {
    // prices
    const USD_PRICE_BN = new BigNumber(1)
    const BTC_PRICE = 70_000n
    const BTC_PRICE_BN = new BigNumber(BTC_PRICE.toString())
    const ETH_PRICE = 3_000n
    const ETH_PRICE_BN = new BigNumber(ETH_PRICE.toString())

    // pool liquidity amounts
    const ONE_BILLION_ETH = parseEther('1000000000')
    const ONE_BILLION_USDC = parseUnits('1000000000', 6)

    const {
        // accounts
        account0,
        account1,

        // tokens
        stablecoin,
        usdc,
        weth,
        wbtc,

        // external test contracts
        factoryUniV3,
        positionManagerUniV3,
        ...rest
    } = await new ProjectDeployer().deployProjectFixture()

    await UniswapV3.mintAndAddLiquidity(
        factoryUniV3,
        positionManagerUniV3,
        wbtc,
        stablecoin,
        ONE_BILLION_ETH / BTC_PRICE,
        ONE_BILLION_ETH,
        BTC_PRICE_BN,
        USD_PRICE_BN,
        account1,
    )

    await UniswapV3.mintAndAddLiquidity(
        factoryUniV3,
        positionManagerUniV3,
        weth,
        usdc,
        ONE_BILLION_ETH / ETH_PRICE,
        ONE_BILLION_USDC,
        ETH_PRICE_BN,
        USD_PRICE_BN,
        account1,
    )

    const stableBtcLpUniV3 = UniswapV3Pool__factory.connect(
        await factoryUniV3.getPool(stablecoin, wbtc, 3000),
        account0,
    )

    const usdcEthLpUniV3 = UniswapV3Pool__factory.connect(
        await factoryUniV3.getPool(usdc, weth, 3000),
        account0,
    )

    return {
        // accounts
        account0,
        account1,

        // tokens
        stablecoin,
        usdc,
        weth,
        wbtc,

        // external test contracts
        factoryUniV3,
        positionManagerUniV3,
        stableBtcLpUniV3,
        usdcEthLpUniV3,
        ...rest,
    }
}
