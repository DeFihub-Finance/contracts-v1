import { CommandBuilder, Salt } from 'hardhat-vanity'
import {
    TestERC20__factory,
    DollarCostAverage,
    StrategyManager,
    SubscriptionManager,
    VaultManager,
    LiquidityManager,
    BuyProduct,
    StrategyPositionManager__factory,
    StrategyInvestor__factory, StrategyManager__v2__factory,
} from '@src/typechain'
import {
    vanityDeployer,
    getDeploymentInfo,
    getProjectDeployer,
    saveAddress,
    sendTransaction,
    verify,
    getImplementationSalt,
    getChainId,
    findAddressOrFail,
    getSigner,
} from '@src/helpers'
import { exchangesMeta, getMainStablecoinOrFail, getSafeOrFail } from '@defihub/shared'
import { upgrade } from '@src/helpers/upgrade'
import { parseUnits, ZeroAddress } from 'ethers'

const TREASURY_ADDR = '0xb7f74ba999134fbb75285173856a808732d8c888' // only use ledger or multisig
const SUBSCRIPTION_SIGNER_ADDR = '0x78dbb65d53566d27b5117532bd9aec6ae95e8db9'
const DCA_SWAPPER_ADDR = '0xa9ce4e7429931418d15cb2d8561372e62247b4cb'
const COMMAND_BUILDER_OPTIONS = { skip: '1' }

async function deployProject() {
    const deployer = await getSigner()
    const chainId = await getChainId()
    const safe = getSafeOrFail(chainId)
    const stable = TestERC20__factory.connect(getMainStablecoinOrFail(chainId), deployer)
    const exchangesUniswapV3 = exchangesMeta[await getChainId()]

    if (!exchangesUniswapV3?.length)
        throw new Error('Exchanges not found')

    const projectDeployer = await getProjectDeployer(deployer)
    const saltBuilder = new Salt(
        vanityDeployer.matcher,
        new CommandBuilder(COMMAND_BUILDER_OPTIONS),
        await projectDeployer.getAddress(),
    )

    // Strategy
    const strategyDeploymentInfo = await getDeploymentInfo(saltBuilder, 'StrategyManager')
    const strategyInvestorSalt = await getImplementationSalt(saltBuilder, 'StrategyInvestor')
    const strategyPositionManagerSalt = await getImplementationSalt(saltBuilder, 'StrategyPositionManager')

    await sendTransaction(
        await projectDeployer.deployStrategyManager
            .populateTransaction(strategyDeploymentInfo),
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
    const subscriptionDeploymentInfo = await getDeploymentInfo(saltBuilder, 'SubscriptionManager')

    await sendTransaction(
        await projectDeployer.deploySubscriptionManager.populateTransaction(subscriptionDeploymentInfo),
        deployer,
    )

    // Products
    const dcaDeploymentInfo = await getDeploymentInfo(saltBuilder, 'DollarCostAverage')
    const vaultDeploymentInfo = await getDeploymentInfo(saltBuilder, 'VaultManager')
    const liquidityDeploymentInfo = await getDeploymentInfo(saltBuilder, 'LiquidityManager')
    const buyProductDeploymentInfo = await getDeploymentInfo(saltBuilder, 'BuyProduct')

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

    const [
        strategyManager,
        strategyInvestor,
        strategyPositionManager,
        dca,
        vaultManager,
        liquidityManager,
        buyProduct,
        subscriptionManager,
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

    await sendTransaction(
        await projectDeployer.initializeProject.populateTransaction(
            subscriptionManagerInitParams,
            strategyManagerInitParams,
            dcaInitParams,
            vaultManagerInitParams,
            liquidityManagerInitParams,
            buyProductInitParams,
        ),
        deployer,
    )

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

    await upgrade(await findAddressOrFail('DollarCostAverage'), 'DollarCostAverage__NoDeadline')
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

deployProject()
