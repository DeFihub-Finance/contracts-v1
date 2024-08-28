import { ERC20Priced, PathUniswapV3 } from '@defihub/shared'
import { ethers } from 'hardhat'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { TestERC20__factory, UniswapV3Pool__factory } from '@src/typechain'
import { deployVaultFixture } from '../../VaultManager/fixtures/deploy-vault.fixture'
import { parseEther } from 'ethers'
import { UniswapV3 } from '@src/helpers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { mockTokenWithAddress } from '@src/helpers/mock-token'
import { StrategyStorage } from '@src/typechain/artifacts/contracts/StrategyManager'

export async function baseStrategyManagerFixture() {
    const [deployer] = await ethers.getSigners()
    const anotherToken = await new TestERC20__factory(deployer).deploy(18)

    // TODO move prices from zap.fixture to here and update necessary tests to work with the new price
    const USD_PRICE_BN = new BigNumber(1)
    const ETH_PRICE = 3_000n
    const ETH_PRICE_BN = new BigNumber(ETH_PRICE.toString())
    const ONE_BILLION_ETH = parseEther('1000000000')

    /////////////////////////////////////
    // Initializing contracts and EOA //
    ///////////////////////////////////
    const {
        account0,
        dca,
        subscriptionSigner,
        subscriptionManager,
        subscriptionMonthlyPrice,
        strategyManager,
        vaultManager,
        stablecoin,
        liquidityManager,
        weth,
        factoryUniV3,
        routerUniV3,
        positionManagerUniV3,
        ...rest
    } = await new ProjectDeployer().deployProjectFixture()

    /////////////////////////////////////
    // Initialize investment contracts //
    ////////////////////////////////////
    const vault = await deployVaultFixture(await stablecoin.getAddress())

    const TOKEN_IN = await stablecoin.getAddress()
    const TOKEN_OUT = await weth.getAddress()

    const path = new PathUniswapV3(TOKEN_IN, [{ token: TOKEN_OUT, fee: 3000 }])

    await UniswapV3.mintAndAddLiquidity(
        factoryUniV3,
        positionManagerUniV3,
        weth,
        stablecoin,
        ONE_BILLION_ETH / ETH_PRICE,
        ONE_BILLION_ETH,
        ETH_PRICE_BN,
        USD_PRICE_BN,
        account0,
    )

    const stableEthLpUniV3 = UniswapV3Pool__factory.connect(
        await factoryUniV3.getPool(stablecoin, weth, 3000),
        account0,
    )

    await Promise.all([
        dca.createPool(
            TOKEN_IN,
            TOKEN_OUT,
            routerUniV3,
            await path.encodedPath(),
            60 * 60 * 24, // 24 hours in seconds
        ),

        dca.createPool(
            TOKEN_IN,
            TOKEN_OUT,
            routerUniV3,
            await path.encodedPath(),
            60 * 60 * 24, // 24 hours in seconds
        ),

        dca.createPool(
            anotherToken,
            TOKEN_OUT,
            routerUniV3,
            await new PathUniswapV3(
                anotherToken,
                [{ token: TOKEN_OUT, fee: 3000 }],
            ).encodedPath(),
            60 * 60 * 24, // 24 hours in seconds
        ),
    ])

    ////////////////////////////////////////////////
    // Subscribing account0 to act as strategist //
    //////////////////////////////////////////////
    const yearlySubscriptionPrice = subscriptionMonthlyPrice * 12n

    await Promise.all([
        stablecoin.mint(account0, yearlySubscriptionPrice),
        stablecoin.connect(account0).approve(subscriptionManager, yearlySubscriptionPrice),
        anotherToken.mint(account0, yearlySubscriptionPrice),
        anotherToken.connect(account0).approve(subscriptionManager, yearlySubscriptionPrice),
    ])

    await subscriptionManager.connect(account0).subscribe()

    ////////////////////////////////////////////////////////
    // Creating strategies to be used to create strategy //
    ///////////////////////////////////////////////////////
    const dcaStrategyPositions: StrategyStorage.DcaInvestmentStruct[] = [
        { poolId: 0, swaps: 10, percentage: 33 },
        { poolId: 1, swaps: 10, percentage: 33 },
    ]
    const vaultStrategyPosition: StrategyStorage.VaultInvestmentStruct[] = [
        {
            vault,
            percentage: 34,
        },
    ]

    //////////////////////////////
    // Mock ERC20Priced tokens //
    ////////////////////////////
    const stablecoinPriced = await mockTokenWithAddress(USD_PRICE_BN, 18, stablecoin)
    const wethPriced = await mockTokenWithAddress(ETH_PRICE_BN, 18, weth)

    const erc20PricedMap = new Map<string, ERC20Priced>([
        [stablecoinPriced.address, stablecoinPriced],
        [wethPriced.address, wethPriced],
    ])

    return {
        // accounts
        account0,
        subscriptionSigner,

        // Hub contracts
        dca,
        vault,
        vaultManager,
        strategyManager,
        subscriptionManager,
        liquidityManager,

        // tokens
        stablecoin,
        weth,
        anotherToken,
        stablecoinPriced,
        wethPriced,

        // external test contracts
        routerUniV3,
        positionManagerUniV3,
        factoryUniV3,

        // global data
        stableEthLpUniV3,
        subscriptionMonthlyPrice,
        dcaStrategyPositions,
        vaultStrategyPosition,
        strategyManagerAddress: await strategyManager.getAddress(),

        // constants
        USD_PRICE_BN,
        ETH_PRICE_BN,

        erc20PricedMap,
        ...rest,
    }
}
