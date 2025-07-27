import { Salt } from 'hardhat-vanity'
import {
    TestERC20__factory,
    DollarCostAverage,
    StrategyManager,
    SubscriptionManager,
    VaultManager,
    LiquidityManager,
    BuyProduct,
    StrategyPositionManager__factory,
    StrategyInvestor__factory,
    StrategyManager__v2__factory,
    ProjectDeployer,
} from '@src/typechain'
import {
    getDeploymentInfo,
    getProjectDeployer,
    saveAddress,
    sendTransaction,
    verify,
    getImplementationSalt,
    getChainId,
    findAddressOrFail,
    getSigner,
    getSaltBuilder,
} from '@src/helpers'
import { getMainStablecoinOrFail, getSafeOrFail } from '@defihub/shared'
import { upgrade } from '@src/helpers/upgrade'
import { parseUnits, ZeroAddress } from 'ethers'

const TREASURY_ADDR = '0xb7f74ba999134fbb75285173856a808732d8c888' // only use ledger or multisig
const SUBSCRIPTION_SIGNER_ADDR = '0x78dbb65d53566d27b5117532bd9aec6ae95e8db9'
const DCA_SWAPPER_ADDR = '0xa9ce4e7429931418d15cb2d8561372e62247b4cb'

async function deployProject() {
    const deployer = await getSigner()
    const chainId = await getChainId()
    const safe = getSafeOrFail(chainId)
    const stable = TestERC20__factory.connect(getMainStablecoinOrFail(chainId), deployer)

    const projectDeployer = await getProjectDeployer(deployer)
    const saltBuilder = await getSaltBuilder(projectDeployer)

    const {
        strategyDeploymentInfo,
        strategyInvestorSalt,
        strategyPositionManagerSalt,
        dcaDeploymentInfo,
        vaultDeploymentInfo,
        liquidityDeploymentInfo,
        buyProductDeploymentInfo,
        subscriptionDeploymentInfo,
    } = await getDeploymentInfos(saltBuilder)

    const {
        strategyInvestor,
        strategyPositionManager,
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
        subscriptionManager,
    } = await predictDeploymentAddresses(
        projectDeployer,
        {
            strategyDeploymentInfo,
            strategyInvestorSalt,
            strategyPositionManagerSalt,
            dcaDeploymentInfo,
            vaultDeploymentInfo,
            liquidityDeploymentInfo,
            buyProductDeploymentInfo,
            subscriptionDeploymentInfo,
        },
    )

    const subscriptionManagerInitParams: SubscriptionManager.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR,
        subscriptionSigner: SUBSCRIPTION_SIGNER_ADDR,
        token: stable,
        pricePerMonth: parseUnits('4.69', await stable.decimals()),
    }

    const strategyManagerInitParams: StrategyManager.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR,
        stable,
        strategyInvestor,
        strategyPositionManager,
        subscriptionManager: subscriptionManager.proxy,
        dca: dca.proxy,
        vaultManager: vaultManager.proxy,
        liquidityManager: liquidityManager.proxy,
        buyProduct: buyProduct.proxy,
        zapManager: ZeroAddress,
        strategistPercentage: 30n,
        hotStrategistPercentage: 50n,
        maxHottestStrategies: 10n,
    }

    const dcaInitParams: DollarCostAverage.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR,
        swapper: DCA_SWAPPER_ADDR,
        strategyManager: strategyManager.proxy,
        subscriptionManager: subscriptionManager.proxy,
        baseFeeBP: 60n,
        nonSubscriberFeeBP: 30n,
    }

    const vaultManagerInitParams: VaultManager.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR,
        strategyManager: strategyManager.proxy,
        subscriptionManager: subscriptionManager.proxy,
        baseFeeBP: 20n,
        nonSubscriberFeeBP: 30n,
    }

    const liquidityManagerInitParams: LiquidityManager.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR,
        subscriptionManager: subscriptionManager.proxy,
        strategyManager: strategyManager.proxy,
        zapManager: ZeroAddress,
        baseFeeBP: 30n,
        nonSubscriberFeeBP: 30n,
    }

    const buyProductInitParams: BuyProduct.InitializeParamsStruct = {
        owner: safe,
        treasury: TREASURY_ADDR,
        subscriptionManager: subscriptionManager.proxy,
        baseFeeBP: 30n,
        nonSubscriberFeeBP: 30n,
    }

    // Strategy
    await sendTransaction(
        await projectDeployer.deployStrategyManager
            .populateTransaction(strategyDeploymentInfo, strategyManagerInitParams),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployStrategyInvestor
            .populateTransaction(StrategyInvestor__factory.bytecode, strategyInvestorSalt),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployStrategyPositionManager
            .populateTransaction(StrategyPositionManager__factory.bytecode, strategyPositionManagerSalt),
        deployer,
    )

    // Helpers
    await sendTransaction(
        await projectDeployer.deploySubscriptionManager
            .populateTransaction(subscriptionDeploymentInfo, subscriptionManagerInitParams),
        deployer,
    )

    // Products
    await sendTransaction(
        await projectDeployer.deployDca
            .populateTransaction(dcaDeploymentInfo, dcaInitParams),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployVaultManager
            .populateTransaction(vaultDeploymentInfo, vaultManagerInitParams),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployLiquidityManager
            .populateTransaction(liquidityDeploymentInfo, liquidityManagerInitParams),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployBuyProduct
            .populateTransaction(buyProductDeploymentInfo, buyProductInitParams),
        deployer,
    )

    const [
        _strategyManager,
        _strategyInvestor,
        _strategyPositionManager,
        _dca,
        _vaultManager,
        _liquidityManager,
        _buyProduct,
        _subscriptionManager,
    ] = (await Promise.all([
        projectDeployer.strategyManager(),
        projectDeployer.strategyInvestor(),
        projectDeployer.strategyPositionManager(),
        projectDeployer.dca(),
        projectDeployer.vaultManager(),
        projectDeployer.liquidityManager(),
        projectDeployer.buyProduct(),
        projectDeployer.subscriptionManager(),
    ]))

    if (
        _strategyInvestor !== strategyInvestor ||
        _strategyPositionManager !== strategyPositionManager ||
        _strategyManager.proxy !== strategyManager.proxy ||
        _dca.proxy !== dca.proxy ||
        _vaultManager.proxy !== vaultManager.proxy ||
        _liquidityManager.proxy !== liquidityManager.proxy ||
        _buyProduct.proxy !== buyProduct.proxy ||
        _subscriptionManager.proxy !== subscriptionManager.proxy
    )
        throw new Error('Deployment addresses do not match the predicted addresses')

    await saveAddress('StrategyInvestor', strategyInvestor)
    await saveAddress('StrategyPositionManager', strategyPositionManager)
    await saveAddress('StrategyManager', strategyManager.proxy)
    await saveAddress('SubscriptionManager', subscriptionManager.proxy)
    await saveAddress('DollarCostAverage', dca.proxy)
    await saveAddress('VaultManager', vaultManager.proxy)
    await saveAddress('LiquidityManager', liquidityManager.proxy)
    await saveAddress('BuyProduct', buyProduct.proxy)

    const contractAddresses = [
        subscriptionManager,
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
    ]

    const implementations = [
        ...contractAddresses.map(({ implementation }) => implementation),
        strategyInvestor,
        strategyPositionManager,
    ]

    for (const address of implementations)
        await verify(address)

    for (const address of contractAddresses) {
        await verify(
            address.proxy,
            [address.implementation, '0x'],
        )
    }

    await upgrade(
        await findAddressOrFail('DollarCostAverage'),
        'DollarCostAverage__NoDeadline',
    )
    await upgrade(
        await findAddressOrFail('StrategyManager'),
        'StrategyManager__v2',
        StrategyManager__v2__factory
            .createInterface()
            .encodeFunctionData(
                'initialize__v2',
                [
                    strategyInvestor,
                    strategyPositionManager,
                    10n,
                ],
            ),
    )
}

async function getDeploymentInfos(saltBuilder: Salt) {
    // strategy
    const strategyDeploymentInfo = await getDeploymentInfo(saltBuilder, 'StrategyManager')
    const strategyInvestorSalt = await getImplementationSalt(saltBuilder, 'StrategyInvestor')
    const strategyPositionManagerSalt = await getImplementationSalt(saltBuilder, 'StrategyPositionManager')

    // products
    const dcaDeploymentInfo = await getDeploymentInfo(saltBuilder, 'DollarCostAverage')
    const vaultDeploymentInfo = await getDeploymentInfo(saltBuilder, 'VaultManager')
    const liquidityDeploymentInfo = await getDeploymentInfo(saltBuilder, 'LiquidityManager')
    const buyProductDeploymentInfo = await getDeploymentInfo(saltBuilder, 'BuyProduct')

    // helpers
    const subscriptionDeploymentInfo = await getDeploymentInfo(saltBuilder, 'SubscriptionManager')

    return {
        strategyInvestorSalt,
        strategyPositionManagerSalt,
        strategyDeploymentInfo,
        dcaDeploymentInfo,
        vaultDeploymentInfo,
        liquidityDeploymentInfo,
        buyProductDeploymentInfo,
        subscriptionDeploymentInfo,
    }
}

async function predictDeploymentAddresses(
    projectDeployer: ProjectDeployer,
    {
        strategyInvestorSalt,
        strategyPositionManagerSalt,
        strategyDeploymentInfo,
        dcaDeploymentInfo,
        vaultDeploymentInfo,
        liquidityDeploymentInfo,
        buyProductDeploymentInfo,
        subscriptionDeploymentInfo,
    }: Awaited<ReturnType<typeof getDeploymentInfos>>,
) {
    const [
        strategyInvestor,
        strategyPositionManager,
    ] = await Promise.all([
        projectDeployer.getDeployAddress(StrategyInvestor__factory.bytecode, strategyInvestorSalt),
        projectDeployer.getDeployAddress(StrategyPositionManager__factory.bytecode, strategyPositionManagerSalt),
    ])

    const [
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
        subscriptionManager,
    ] = await Promise.all([
        projectDeployer.getDeployProxyAddress(strategyDeploymentInfo),
        projectDeployer.getDeployProxyAddress(dcaDeploymentInfo),
        projectDeployer.getDeployProxyAddress(vaultDeploymentInfo),
        projectDeployer.getDeployProxyAddress(liquidityDeploymentInfo),
        projectDeployer.getDeployProxyAddress(buyProductDeploymentInfo),
        projectDeployer.getDeployProxyAddress(subscriptionDeploymentInfo),
    ])

    return {
        strategyInvestor,
        strategyPositionManager,
        strategyManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
        subscriptionManager,
    }
}

deployProject()
