import { PathUniswapV3, SubscriptionSigner } from '@defihub/shared'
import { UniswapV2, UniswapV3 } from '@src/helpers'
import { NetworkService } from '@src/NetworkService'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { UniswapV2Pair__factory, UniswapV3Pool__factory } from '@src/typechain'
import { parseEther, parseUnits } from 'ethers'
import { BTC_PRICE, BTC_PRICE_BN, ETH_PRICE, ETH_PRICE_BN, USD_PRICE_BN } from '@src/constants'

export async function zapFixture() {
    const ONE_BILLION_ETH = parseEther('1000000000')
    const ONE_BILLION_USDC = parseUnits('1000000000', 6)

    // global data
    const chainId = await NetworkService.getChainId()
    const deadline = await NetworkService.getBlockTimestamp() + 10_000

    const {
        // accounts
        account0,
        account1,
        subscriptionSigner: subscriptionSignerAccount,
        treasury,

        // tokens
        stablecoin,
        usdc,
        weth,
        wbtc,

        // hub contracts
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        subscriptionManager,
        buyProduct,

        // external test contracts
        universalRouter,
        routerUniV2,
        factoryUniV2,
        factoryUniV3,
        routerUniV3,
        positionManagerUniV3,
    } = await new ProjectDeployer().deployProjectFixture()

    const subscriptionSignerHelper = new SubscriptionSigner(
        subscriptionManager,
        subscriptionSignerAccount,
    )

    const permitAccount0 = await subscriptionSignerHelper
        .signSubscriptionPermit(account0, deadline, chainId)

    await UniswapV2.mintAndAddLiquidity(
        routerUniV2,
        stablecoin,
        wbtc,
        ONE_BILLION_ETH,
        ONE_BILLION_ETH / BTC_PRICE,
        account1,
    )

    await UniswapV2.mintAndAddLiquidity(
        routerUniV2,
        stablecoin,
        weth,
        ONE_BILLION_ETH,
        ONE_BILLION_ETH / ETH_PRICE,
        account1,
    )

    await UniswapV2.mintAndAddLiquidity(
        routerUniV2,
        wbtc,
        weth,
        ONE_BILLION_ETH / BTC_PRICE,
        ONE_BILLION_ETH / ETH_PRICE,
        account1,
    )

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
        stablecoin,
        ONE_BILLION_ETH / ETH_PRICE,
        ONE_BILLION_ETH,
        ETH_PRICE_BN,
        USD_PRICE_BN,
        account1,
    )

    await UniswapV3.mintAndAddLiquidity(
        factoryUniV3,
        positionManagerUniV3,
        stablecoin,
        usdc,
        ONE_BILLION_ETH,
        ONE_BILLION_USDC,
        USD_PRICE_BN,
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

    await UniswapV3.mintAndAddLiquidity(
        factoryUniV3,
        positionManagerUniV3,
        weth,
        wbtc,
        ONE_BILLION_ETH / ETH_PRICE,
        ONE_BILLION_ETH / BTC_PRICE,
        ETH_PRICE_BN,
        BTC_PRICE_BN,
        account1,
    )

    const btcEthLpUniV2 = UniswapV2Pair__factory.connect(
        await factoryUniV2.getPair(wbtc, weth),
        account0,
    )

    const stableBtcLpUniV3 = UniswapV3Pool__factory.connect(
        await factoryUniV3.getPool(stablecoin, wbtc, 3000),
        account0,
    )

    const usdcEthLpUniV3 = UniswapV3Pool__factory.connect(
        await factoryUniV3.getPool(usdc, weth, 3000),
        account0,
    )

    const btcEthLpUniV3 = UniswapV3Pool__factory.connect(
        await factoryUniV3.getPool(weth, wbtc, 3000),
        account0,
    )

    const stableBtcPoolId = await dca.getPoolsLength()

    await dca.createPool(
        stablecoin,
        wbtc,
        routerUniV3,
        (await PathUniswapV3.fromAddressLike(stablecoin, [{ token: wbtc, fee: 3000 }])).encodedPath(),
        60 * 60 * 24, // 24h
    )

    const btcEthPoolId = await dca.getPoolsLength()

    await dca.createPool(
        wbtc,
        weth,
        routerUniV3,
        (await PathUniswapV3.fromAddressLike(wbtc, [{ token: weth, fee: 3000 }])).encodedPath(),
        60 * 60 * 24, // 24h
    )

    const strategyId = await strategyManager.getStrategiesLength()
    const initialTreasuryBalance = await stablecoin.balanceOf(treasury)

    return {
        // accounts
        account0,
        account1,
        subscriptionSignerAccount,
        treasury,

        // tokens
        stablecoin,
        usdc,
        weth,
        wbtc,

        // hub contracts
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        subscriptionManager,
        buyProduct,

        // external test contracts
        universalRouter,
        routerUniV2,
        factoryUniV2,
        factoryUniV3,
        routerUniV3,
        positionManagerUniV3,

        // global data
        strategyId,
        stableBtcPoolId,
        btcEthPoolId,
        initialTreasuryBalance,
        permitAccount0,
        btcEthLpUniV2,
        stableBtcLpUniV3,
        usdcEthLpUniV3,
        btcEthLpUniV3,

        // constants,
        ONE_BILLION_ETH,
    }
}
