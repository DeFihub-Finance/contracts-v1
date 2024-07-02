import { PathUniswapV3, SubscriptionSigner } from '@defihub/shared'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { UniswapV2, UniswapV2ZapHelper, UniswapV3, UniswapV3ZapHelper } from '@src/helpers'
import { NetworkService } from '@src/NetworkService'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { TestERC20__factory, UniswapV2Pair__factory, UniswapV3Pool__factory } from '@src/typechain'
import { parseEther } from 'ethers'
import hre from 'hardhat'

export async function zapFixture() {
    const [deployer] = await hre.ethers.getSigners()
    const stablecoin = await new TestERC20__factory(deployer).deploy()
    const USD_PRICE_BN = new BigNumber(1)
    const BTC_PRICE = 70_000n
    const BTC_PRICE_BN = new BigNumber(BTC_PRICE.toString())
    const ETH_PRICE = 10_000n
    const ETH_PRICE_BN = new BigNumber(ETH_PRICE.toString())
    const ONE_BILLION_ETH = parseEther('1000000000')

    // global data
    const chainId = await NetworkService.getChainId()
    const deadline = await NetworkService.getBlockTimestamp() + 10_000

    function deployProjectFixture() {
        return new ProjectDeployer(
            stablecoin,
            stablecoin,
        ).deployProjectFixture()
    }

    const {
        // accounts
        account0,
        account1,
        subscriptionSigner: subscriptionSignerAccount,
        treasury,

        // tokens
        weth,
        wbtc,

        // hub contracts
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        subscriptionManager,
        zapManager,

        // external test contracts
        routerUniV2,
        factoryUniV2,
        factoryUniV3,
        routerUniV3,
        positionManagerUniV3,
    } = await loadFixture(deployProjectFixture)

    const subscriptionSignerHelper = new SubscriptionSigner(
        subscriptionManager,
        subscriptionSignerAccount,
    )

    const uniswapV2ZapHelper = new UniswapV2ZapHelper()
    const uniswapV3ZapHelper = new UniswapV3ZapHelper()
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

    const btcEthLpUniV3 = UniswapV3Pool__factory.connect(
        await factoryUniV3.getPool(weth, wbtc, 3000),
        account0,
    )

    const stableBtcPoolId = await dca.getPoolsLength()

    await dca.createPool(
        stablecoin,
        wbtc,
        routerUniV3,
        await new PathUniswapV3(stablecoin, [{ token: wbtc, fee : 3000 }]).encodedPath(),
        60 * 60 * 24, // 24h
    )

    const btcEthPoolId = await dca.getPoolsLength()

    await dca.createPool(
        wbtc,
        weth,
        routerUniV3,
        await new PathUniswapV3(wbtc, [{ token: weth, fee : 3000 }]).encodedPath(),
        60 * 60 * 24, // 24h
    )

    const strategyId = await strategyManager.getStrategiesLength()
    const initialTreasuryBalance = await stablecoin.balanceOf(treasury)

    await liquidityManager.setPositionManagerWhitelist(positionManagerUniV3, true)

    return {
        // accounts
        account0,
        account1,
        subscriptionSignerAccount,
        treasury,

        // tokens
        stablecoin,
        weth,
        wbtc,

        // hub contracts
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        subscriptionManager,
        zapManager,

        // external test contracts
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
        btcEthLpUniV3,

        // helpers
        uniswapV2ZapHelper,
        uniswapV3ZapHelper,

        // constants,
        USD_PRICE_BN,
        BTC_PRICE,
        BTC_PRICE_BN,
        ETH_PRICE,
        ETH_PRICE_BN,
        ONE_BILLION_ETH,
    }
}
