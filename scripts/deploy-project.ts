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
    BuyProduct,
} from '@src/typechain'
import {
    vanityDeployer,
    getDeploymentInfo,
    getProjectDeployer,
    saveAddress,
    sendTransaction,
    verify,
    findAddressOrFail,
    getImplementationSalt,
} from '@src/helpers'

const TREASURY_ADDR: string | undefined = '0xb7f74ba999134fbb75285173856a808732d8c888' // wallet 61
const SUBSCRIPTION_SIGNER_ADDR: string | undefined = '0x78dbb65d53566d27b5117532bd9aec6ae95e8db9' // mm signer
const DCA_SWAPPER_ADDR = '0xa9ce4e7429931418d15cb2d8561372e62247b4cb' // TODO update with backend addr defender relay
const COMMAND_BUILDER_OPTIONS = { skip: '1' }

async function deployProject() {
    const [deployer] = await hre.ethers.getSigners()
    const safe = await findAddressOrFail('GnosisSafe')
    const treasury = TREASURY_ADDR || safe
    const stable = TestERC20__factory.connect(await findAddressOrFail('Stablecoin'), deployer)
    const projectDeployer = await getProjectDeployer(deployer)

    const saltBuilder = new Salt(
        vanityDeployer.matcher,
        new CommandBuilder(COMMAND_BUILDER_OPTIONS),
        await projectDeployer.getAddress(),
    )

    const investLibDeploymentInfo = await getImplementationSalt(saltBuilder, 'InvestLib')
    const subscriptionDeploymentInfo = await getDeploymentInfo(saltBuilder, 'SubscriptionManager')
    const strategyDeploymentInfo = await getDeploymentInfo(saltBuilder, 'StrategyManager')
    const dcaDeploymentInfo = await getDeploymentInfo(saltBuilder, 'DollarCostAverage')
    const vaultDeploymentInfo = await getDeploymentInfo(saltBuilder, 'VaultManager')
    const liquidityDeploymentInfo = await getDeploymentInfo(saltBuilder, 'LiquidityManager')
    const buyProductDeploymentInfo = await getDeploymentInfo(saltBuilder, 'BuyProduct')
    const zapManagerInfo = await getDeploymentInfo(saltBuilder, 'ZapManager')

    await sendTransaction(
        await projectDeployer.deployInvestLib
            .populateTransaction(InvestLib__factory.bytecode, investLibDeploymentInfo),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deploySubscriptionManager
            .populateTransaction(subscriptionDeploymentInfo),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployStrategyManager
            .populateTransaction(strategyDeploymentInfo),
        deployer,
    )
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
            .populateTransaction(liquidityDeploymentInfo),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployBuyProduct
            .populateTransaction(buyProductDeploymentInfo),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployZapManager
            .populateTransaction(zapManagerInfo),
        deployer,
    )

    const investLib = await projectDeployer.investLib()
    const [
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
        subscriptionManager,
        zapManager,
    ] = (await Promise.all([
        projectDeployer.strategyManager(),
        projectDeployer.dca(),
        projectDeployer.vaultManager(),
        projectDeployer.liquidityManager(),
        projectDeployer.buyProduct(),
        projectDeployer.subscriptionManager(),
        projectDeployer.zapManager(),
    ]))

    const subscriptionManagerInitParams: SubscriptionManager.InitializeParamsStruct = {
        owner: safe,
        treasury,
        subscriptionSigner: SUBSCRIPTION_SIGNER_ADDR || safe,
        token: stable,
        pricePerMonth: ethers.parseUnits('4.69', await stable.decimals()),
    }

    const strategyManagerInitParams: StrategyManager.InitializeParamsStruct = {
        owner: safe,
        treasury,
        stable,
        investLib,
        subscriptionManager: subscriptionManager.proxy,
        dca: dca.proxy,
        vaultManager: vaultManager.proxy,
        liquidityManager: liquidityManager.proxy,
        buyProduct: buyProduct.proxy,
        zapManager: vaultManager.proxy,
        strategistPercentage: 30n,
        hotStrategistPercentage: 50n,
        maxHottestStrategies: 10n,
    }

    const dcaInitParams: DollarCostAverage.InitializeParamsStruct = {
        owner: safe,
        treasury,
        swapper: DCA_SWAPPER_ADDR,
        strategyManager: strategyManager.proxy,
        subscriptionManager: subscriptionManager.proxy,
        baseFeeBP: 60n,
        nonSubscriberFeeBP: 30n,
    }

    const vaultManagerInitParams: VaultManager.InitializeParamsStruct = {
        owner: safe,
        treasury,
        strategyManager: strategyManager.proxy,
        subscriptionManager: subscriptionManager.proxy,
        baseFeeBP: 20n,
        nonSubscriberFeeBP: 30n,
    }

    const liquidityManagerInitParams: LiquidityManager.InitializeParamsStruct = {
        owner: safe,
        treasury,
        subscriptionManager: subscriptionManager.proxy,
        strategyManager: strategyManager.proxy,
        zapManager: zapManager.proxy,
        baseFeeBP: 30n,
        nonSubscriberFeeBP: 30n,
    }

    const buyProductInitParams: BuyProduct.InitializeParamsStruct = {
        owner: safe,
        treasury,
        subscriptionManager: subscriptionManager.proxy,
        baseFeeBP: 30n,
        nonSubscriberFeeBP: 30n,
    }

    const zapManagerInitParams: ZapManager.InitializeParamsStruct = {
        owner: safe,
        uniswapV2ZapperConstructor: {
            treasury,
            swapRouter: await findAddressOrFail('UniswapRouterV2'),
        },
        uniswapV3ZapperConstructor: {
            positionManager: await findAddressOrFail('UniswapPositionManagerV3'),
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
            buyProductInitParams,
            zapManagerInitParams,
        ),
        deployer,
    )

    const zapManagerContract = ZapManager__factory.connect(zapManager.proxy, deployer)
    const [
        zapperUniV2,
        zapperUniV3,
    ] = await Promise.all([
        zapManagerContract.protocolImplementations('UniswapV2'),
        zapManagerContract.protocolImplementations('UniswapV3'),
    ])

    await saveAddress('SubscriptionManager', subscriptionManager.proxy)
    await saveAddress('InvestLib', investLib)
    await saveAddress('StrategyManager', strategyManager.proxy)
    await saveAddress('DollarCostAverage', dca.proxy)
    await saveAddress('VaultManager', vaultManager.proxy)
    await saveAddress('LiquidityManager',liquidityManager.proxy)
    await saveAddress('BuyProduct', buyProduct.proxy)
    await saveAddress('ZapManager', zapManager.proxy)
    await saveAddress('ZapperUniswapV2', zapperUniV2)
    await saveAddress('ZapperUniswapV3', zapperUniV3)

    const contractAddresses = [
        subscriptionManager,
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
        zapManager,
    ]

    const implementations = [
        ...contractAddresses.map(({ implementation }) => implementation),
        investLib,
    ]

    await verify(
        zapperUniV2,
        [
            {
                treasury,
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
