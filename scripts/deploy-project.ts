import hre, { ethers } from 'hardhat'
import { CommandBuilder, Salt } from 'hardhat-vanity'
import {
    TestERC20__factory,
    DollarCostAverage,
    StrategyManager,
    SubscriptionManager,
    VaultManager,
    ZapManager,
    ZapManager__factory,
    UniswapV2Zapper__factory,
    UniswapV3Zapper__factory,
    InvestLib__factory,
    LiquidityManager,
} from '@src/typechain'
import {
    getDeploymentInfo,
    getProjectDeployer,
    saveAddress,
    vanityDeployer,
    sendTransaction,
    verify,
    findAddressOrFail,
    getImplementationSalt,
} from '@src/helpers'

const TREASURY_ADDR: string | undefined = '0xb7f74ba999134fbb75285173856a808732d8c888' // wallet 61
const DCA_SWAPPER_ADDR: string | undefined = '0xa9ce4e7429931418d15cb2d8561372e62247b4cb' // TODO update with backend addr defender relay
const SUBSCRIPTION_SIGNER_ADDR: string | undefined = '0x78dbb65d53566d27b5117532bd9aec6ae95e8db9' // mm signer
const COMMAND_BUILDER_OPTIONS = { skip: '1' }

async function deployProject() {
    const [deployer] = await hre.ethers.getSigners()
    const safe = await findAddressOrFail('GnosisSafe')
    const stable = TestERC20__factory.connect(
        await findAddressOrFail('Stablecoin'),
        deployer,
    )
    const projectDeployer = await getProjectDeployer(deployer)

    const saltBuilder = new Salt(
        vanityDeployer.matcher,
        new CommandBuilder(COMMAND_BUILDER_OPTIONS),
        await projectDeployer.getAddress(),
    )

    const investLibSalt = await getImplementationSalt(saltBuilder, 'InvestLib')
    const strategyDeploymentInfo = await getDeploymentInfo(saltBuilder, 'StrategyManager')
    const dcaDeploymentInfo = await getDeploymentInfo(saltBuilder, 'DollarCostAverage')
    const vaultDeploymentInfo = await getDeploymentInfo(saltBuilder, 'VaultManager')
    const liquidityManagerDeploymentInfo = await getDeploymentInfo(saltBuilder, 'LiquidityManager')
    const subscriptionDeploymentInfo = await getDeploymentInfo(saltBuilder, 'SubscriptionManager')
    const zapManagerInfo = await getDeploymentInfo(saltBuilder, 'ZapManager')

    await sendTransaction(
        await projectDeployer.deployInvestLib
            .populateTransaction(InvestLib__factory.bytecode, investLibSalt),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployStrategyManager
            .populateTransaction(strategyDeploymentInfo),
        deployer,
    )

    // products
    await sendTransaction(
        await projectDeployer.deployDca
            .populateTransaction(dcaDeploymentInfo),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployVaultManager
            .populateTransaction(vaultDeploymentInfo),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployLiquidityManager
            .populateTransaction(liquidityManagerDeploymentInfo),
        deployer,
    )

    // helpers
    await sendTransaction(
        await projectDeployer.deployZapManager
            .populateTransaction(zapManagerInfo),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deploySubscriptionManager
            .populateTransaction(subscriptionDeploymentInfo),
        deployer,
    )

    const [
        investLib,
        subscriptionManager,
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        zapManager,
    ] = await Promise.all([
        projectDeployer.investLib(),
        projectDeployer.subscriptionManager(),
        projectDeployer.strategyManager(),
        projectDeployer.dca(),
        projectDeployer.vaultManager(),
        projectDeployer.liquidityManager(),
        projectDeployer.zapManager(),
    ])

    const subscriptionManagerInitParams: SubscriptionManager.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR || safe,
        subscriptionSigner: SUBSCRIPTION_SIGNER_ADDR || safe,
        token: await stable.getAddress(),
        pricePerMonth: ethers.parseUnits('4.69', await stable.decimals()),
    }

    const strategyManagerInitParams: StrategyManager.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR || safe,
        stable: await stable.getAddress(),
        investLib: investLib,
        subscriptionManager: subscriptionManager.proxy,
        dca: dca.proxy,
        vaultManager: vaultManager.proxy,
        liquidityManager: liquidityManager.proxy,
        zapManager: zapManager.proxy,
        strategistPercentage: 30n,
        hotStrategistPercentage: 50n,
        maxHottestStrategies: 10n,
    }

    const dcaInitParams: DollarCostAverage.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR || safe,
        swapper: DCA_SWAPPER_ADDR || safe,
        strategyManager: strategyManager.proxy,
        subscriptionManager: subscriptionManager.proxy,
        baseFeeBP: 70n,
        nonSubscriberFeeBP: 30n,
    }

    const vaultManagerInitParams: VaultManager.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR || safe,
        strategyManager: strategyManager.proxy,
        subscriptionManager: subscriptionManager.proxy,
        baseFeeBP: 70n,
        nonSubscriberFeeBP: 30n,
    }

    const liquidityManagerInitParams: LiquidityManager.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR || safe,
        strategyManager: strategyManager.proxy,
        subscriptionManager: subscriptionManager.proxy,
        zapManager: zapManager.proxy,
        baseFeeBP: 30n,
        nonSubscriberFeeBP: 30n,
    }

    const zapManagerInitParams: ZapManager.InitializeParamsStruct = {
        owner: safe,
        uniswapV2ZapperConstructor: {
            treasury: TREASURY_ADDR || safe,
            swapRouter: await findAddressOrFail('UniswapRouterV2'),
        },
        uniswapV3ZapperConstructor: {
            positionManager: safe, // TODO this isn't correct, should be position manager and not gnosis safe
            swapRouter: await findAddressOrFail('UniswapRouterV3'),
        },
    }

    await sendTransaction(
        await projectDeployer.initializeProject.populateTransaction(
            subscriptionManagerInitParams,
            strategyManagerInitParams,
            dcaInitParams,
            vaultManagerInitParams,
            liquidityManagerInitParams,
            zapManagerInitParams,
        ),
        deployer,
    )

    const zapManagerContract = ZapManager__factory.connect(zapManager.proxy, deployer)
    const [zapperUniV2, zapperUniV3] = await Promise.all([
        zapManagerContract.protocolImplementations('UniswapV2'),
        zapManagerContract.protocolImplementations('UniswapV3'),
    ])

    await saveAddress('SubscriptionManager', subscriptionManager.proxy)
    await saveAddress('StrategyManager', strategyManager.proxy)
    await saveAddress('DollarCostAverage', dca.proxy)
    await saveAddress('VaultManager', vaultManager.proxy)
    await saveAddress('ZapManager', zapManager.proxy)
    await saveAddress('ZapperUniswapV2', zapperUniV2)
    await saveAddress('ZapperUniswapV3', zapperUniV3)

    const contractAddresses = [
        subscriptionManager,
        strategyManager,
        dca,
        vaultManager,
        zapManager,
    ]

    const implementations = contractAddresses.map(({ implementation }) => implementation)

    await verify(
        zapperUniV2,
        [
            {
                treasury: TREASURY_ADDR || safe,
                swapRouter: await UniswapV2Zapper__factory.connect(zapperUniV2, deployer).swapRouter(),
            },
        ],
    )

    await verify(
        zapperUniV3,
        [
            {
                positionManager: await UniswapV3Zapper__factory.connect(zapperUniV3, deployer).positionManager(),
                swapRouter: await UniswapV3Zapper__factory.connect(zapperUniV3, deployer).swapRouter(),
            },
        ],
    )

    for (const address of implementations)
        await verify(address)

    for (const address of contractAddresses) {
        await verify(
            address.proxy,
            [address.implementation, '0x'],
        )
    }
}

deployProject()
