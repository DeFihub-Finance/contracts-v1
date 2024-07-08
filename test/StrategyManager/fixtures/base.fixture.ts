import { PathUniswapV3, unwrapAddressLike } from '@defihub/shared'
import { ethers } from 'hardhat'
import { ProjectDeployer } from '@src/ProjectDeployer'
import {
    TestERC20__factory,
    UniswapV3Factory,
    UniswapV3Pool__factory,
    NonFungiblePositionManager,
    TestERC20,
} from '@src/typechain'
import { InvestLib } from '@src/typechain/artifacts/contracts/StrategyManager' // typechain doesn't generate lib properly so we must import it this way
import { NetworkService } from '@src/NetworkService'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { deployVaultFixture } from '../../VaultManager/fixtures/deploy-vault.fixture'
import { Signer, parseEther } from 'ethers'
import { UniswapV3 } from '@src/helpers'
import { BigNumber } from '@ryze-blockchain/ethereum'

export const baseStrategyManagerFixture = async () => {
    const [deployer] = await ethers.getSigners()
    const stablecoin = await new TestERC20__factory(deployer).deploy()
    const token = stablecoin // alias
    const anotherToken = await new TestERC20__factory(deployer).deploy()

    const USD_PRICE_BN = new BigNumber(1)
    const ETH_PRICE = 3_000n
    const ETH_PRICE_BN = new BigNumber(ETH_PRICE.toString())

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
        liquidityManager,
        weth,
        wbtc,
        factoryUniV3,
        routerUniV3,
        positionManagerUniV3,
        ...rest
    } = await new ProjectDeployer(
        stablecoin,
        stablecoin,
    ).deployProjectFixture()

    /////////////////////////////////////
    // Initialize investment contrats //
    ////////////////////////////////////
    const vault = await deployVaultFixture(await token.getAddress())

    await vaultManager.setVaultWhitelistStatus(await vault.getAddress(), true)

    const TOKEN_IN = await token.getAddress()
    const TOKEN_OUT = await weth.getAddress()

    const path = new PathUniswapV3(TOKEN_IN, [{ token: TOKEN_OUT, fee: 3000 }])

    const stableEthLpUniV3 = await bootstrapDcaPoolLiquidity(
        deployer,
        factoryUniV3,
        positionManagerUniV3,
        token,
        weth,
        1,
        ETH_PRICE,
    )

    const routerAddress = await routerUniV3.getAddress()

    await Promise.all([
        dca.createPool(
            TOKEN_IN,
            TOKEN_OUT,
            routerAddress,
            await path.encodedPath(),
            60 * 60 * 24, // 24 hours in seconds
        ),

        dca.createPool(
            TOKEN_IN,
            TOKEN_OUT,
            routerAddress,
            await path.encodedPath(),
            60 * 60 * 24, // 24 hours in seconds
        ),

        dca.createPool(
            await anotherToken.getAddress(),
            TOKEN_OUT,
            routerAddress,
            await new PathUniswapV3(
                await anotherToken.getAddress(),
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
        token.mint(account0, yearlySubscriptionPrice),
        token.connect(account0).approve(subscriptionManager, yearlySubscriptionPrice),
        anotherToken.mint(account0, yearlySubscriptionPrice),
        anotherToken.connect(account0).approve(subscriptionManager, yearlySubscriptionPrice),
    ])

    await subscriptionManager.connect(account0).subscribe()
    await liquidityManager.setPositionManagerWhitelist(positionManagerUniV3, true)

    ////////////////////////////////////////////////////////
    // Creating strategies to be used to create strategy //
    ///////////////////////////////////////////////////////
    const dcaStrategyPositions: InvestLib.DcaInvestmentStruct[] = [
        { poolId: 0, swaps: 10, percentage: 25 },
        { poolId: 1, swaps: 10, percentage: 25 },
    ]
    const vaultStrategyPosition: InvestLib.VaultInvestmentStruct[] = [
        {
            vault: await vault.getAddress(),
            percentage: 25,
        },
    ]

    const { token0, token1 } = UniswapV3.sortTokens(
        await unwrapAddressLike(wbtc),
        await unwrapAddressLike(weth),
    )

    const liquidityInvestmentPositions: InvestLib.LiquidityInvestmentStruct[] = [
        {
            fee: 3000,
            lowerPricePercentage: 10,
            upperPricePercentage: 10,
            percentage: 25,
            positionManager: positionManagerUniV3,
            token0,
            token1,
        },
    ]

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

        // tokens
        weth,
        token,
        stablecoin,
        anotherToken,

        // external test contracts
        routerUniV3,
        positionManagerUniV3,
        factoryUniV3,

        // global data
        stableEthLpUniV3,
        subscriptionMonthlyPrice,
        dcaStrategyPositions,
        vaultStrategyPosition,
        liquidityInvestmentPositions,
        strategyManagerAddress: await strategyManager.getAddress(),
        subscriptionSignature: new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        ),

        // constants
        USD_PRICE_BN,
        ETH_PRICE_BN,

        ...rest,
    }
}

async function bootstrapDcaPoolLiquidity(
    liquidityProvider: Signer,
    factory: UniswapV3Factory,
    positionManager: NonFungiblePositionManager,
    inputToken: TestERC20,
    outputToken: TestERC20,
    inputPerOutputTokenPrice: number,
    fee: bigint,
) {
    const thousand = parseEther('1000')
    const { token0, token1 } = UniswapV3.sortTokens(
        await unwrapAddressLike(inputToken),
        await unwrapAddressLike(outputToken),
    )

    const inputTokenIsToken0 = token0 === (await inputToken.getAddress())

    await positionManager.createAndInitializePoolIfNecessary(
        token0,
        token1,
        fee,
        UniswapV3.calculateSqrtPriceX96(
            inputTokenIsToken0 ? inputPerOutputTokenPrice : 1,
            inputTokenIsToken0 ? 1 : inputPerOutputTokenPrice,
        ),
    )

    await Promise.all([
        inputToken.mint(liquidityProvider, thousand),
        inputToken.connect(liquidityProvider).approve(positionManager, thousand),
        outputToken.mint(liquidityProvider, thousand),
        outputToken.connect(liquidityProvider).approve(positionManager, thousand),
    ])

    await positionManager.mint({
        token0,
        token1,
        fee,
        tickLower: -887220,
        tickUpper: 887220,
        amount0Desired: thousand,
        amount1Desired: thousand,
        amount0Min: 0,
        amount1Min: 0,
        recipient: positionManager, // For this case, doesn't matter who holds the liquidity
        deadline: await NetworkService.getBlockTimestamp() + 60 * 60 * 24, // 24 hours in seconds
    })

    return UniswapV3Pool__factory.connect(await factory.getPool(token0, token1, fee))
}
