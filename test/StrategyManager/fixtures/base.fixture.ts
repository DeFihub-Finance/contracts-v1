import { PathUniswapV3 } from '@defihub/shared'
import { ethers } from 'hardhat'
import { ProjectDeployer } from '@src/ProjectDeployer'
import {
    StrategyManager,
    TestERC20__factory,
    UniswapV3Factory,
    UniswapV3Pool__factory,
    NonFungiblePositionManager,
    TestERC20,
} from '@src/typechain'
import { NetworkService } from '@src/NetworkService'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { deployVaultFixture } from '../../VaultManager/fixtures/deploy-vault.fixture'
import { Signer, parseEther } from 'ethers'
import { UniswapV3 } from '@src/helpers'

export const baseStrategyManagerFixture = async () => {
    const [deployer] = await ethers.getSigners()
    const stablecoin = await new TestERC20__factory(deployer).deploy()
    const token = stablecoin // alias
    const anotherToken = await new TestERC20__factory(deployer).deploy()

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
        weth,
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

    await bootstrapDcaPoolLiquidity(
        deployer,
        factoryUniV3,
        positionManagerUniV3,
        token,
        weth,
        1,
        3000n,
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

    ////////////////////////////////////////////////////////
    // Creating strategies to be used to create strategy //
    ///////////////////////////////////////////////////////
    const dcaStrategyPositions: StrategyManager.DcaInvestmentStruct[] = [
        { poolId: 0, swaps: 10, percentage: 33 },
        { poolId: 1, swaps: 10, percentage: 33 },
    ]
    const vaultStrategyPosition: StrategyManager.VaultInvestmentStruct[] = [
        {
            vault: await vault.getAddress(),
            percentage: 34,
        },
    ]

    return {
        account0,
        dca,
        token,
        anotherToken,
        vault,
        subscriptionManager,
        strategyManager,
        strategyManagerAddress: await strategyManager.getAddress(),
        subscriptionMonthlyPrice,
        vaultManager,
        dcaStrategyPositions,
        vaultStrategyPosition,
        subscriptionSigner,
        subscriptionSignature: new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        ),
        weth,
        stablecoin,
        routerUniV3,
        positionManagerUniV3,
        factoryUniV3,
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
    const [token0, token1] = [
        await inputToken.getAddress(),
        await outputToken.getAddress(),
    ].sort((a, b) => parseInt(a, 16) - parseInt(b, 16))
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
