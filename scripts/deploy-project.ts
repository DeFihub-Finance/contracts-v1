import { CommandBuilder, Salt } from 'hardhat-vanity'
import {
    TestERC20__factory,
    DollarCostAverage,
    StrategyManager,
    SubscriptionManager,
    VaultManager,
    ZapManager,
    ZapManager__factory,
    LiquidityManager,
    BuyProduct,
    StrategyPositionManager__factory,
    StrategyInvestor__factory,
    ZapperUniswapV2__factory,
    SwapperUniswapV3__factory,
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
import { exchangesMeta, mainStablecoins } from '@defihub/shared'
import { upgrade } from '@src/helpers/upgrade'
import { ChainId, EthErrors } from '@ryze-blockchain/ethereum'
import { parseUnits } from 'ethers'
import { getSafeAddress } from '@src/helpers/safe'

interface ExchangeInitializer {
    protocol: string
    swapRouter: string
}

const ExchangeTypes = {
    UniswapV2: 'UniswapV2',
    UniswapV3: 'UniswapV3',
} as const

const TREASURY_ADDR = '0xb7f74ba999134fbb75285173856a808732d8c888' // only use ledger or multisig
const SUBSCRIPTION_SIGNER_ADDR = '0x78dbb65d53566d27b5117532bd9aec6ae95e8db9'
const DCA_SWAPPER_ADDR = '0xa9ce4e7429931418d15cb2d8561372e62247b4cb'
const COMMAND_BUILDER_OPTIONS = { skip: '1' }

const exchangesUniswapV2: ExchangeInitializer[] = []

function getStablecoin(chainId: ChainId) {
    const stablecoin = mainStablecoins[chainId as keyof typeof mainStablecoins]

    if (!stablecoin)
        throw new Error(EthErrors.UNSUPPORTED_CHAIN)

    return stablecoin
}

async function deployProject() {
    const deployer = await getSigner()
    const chainId = await getChainId()
    const safe = getSafeAddress(chainId)
    const stable = TestERC20__factory.connect(getStablecoin(chainId), deployer)
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
    const zapManagerInfo = await getDeploymentInfo(saltBuilder, 'ZapManager')

    await sendTransaction(
        await projectDeployer.deploySubscriptionManager.populateTransaction(subscriptionDeploymentInfo),
        deployer,
    )
    await sendTransaction(
        await projectDeployer.deployZapManager.populateTransaction(zapManagerInfo),
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
        zapManager,
    ] = (await Promise.all([
        projectDeployer.strategyManager(),
        projectDeployer.strategyInvestor(),
        projectDeployer.strategyPositionManager(),
        projectDeployer.dca(),
        projectDeployer.vaultManager(),
        projectDeployer.liquidityManager(),
        projectDeployer.buyProduct(),
        projectDeployer.subscriptionManager(),
        projectDeployer.zapManager(),
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
        zapManager: zapManager.proxy,
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
        zapManager: zapManager.proxy,
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

    const zapManagerInitParams: ZapManager.InitializeParamsStruct = {
        owner: safe,
        zappersUniswapV2: exchangesUniswapV2.map(exchange => ({
            name: exchange.protocol,
            constructorParams: {
                treasury: TREASURY_ADDR,
                swapRouter: exchange.swapRouter,
            },
        })),
        swappersUniswapV3: exchangesUniswapV3.map(exchange => ({
            name: exchange.protocol,
            constructorParams: {
                swapRouter: exchange.router,
            },
        })),
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
    const zapProtocolImplementations = await Promise.all(
        [
            ...exchangesUniswapV2.map(({ protocol }) => ({ protocol, type: ExchangeTypes.UniswapV2 })),
            ...exchangesUniswapV3.map(({ protocol }) => ({ protocol, type: ExchangeTypes.UniswapV3 })),
        ].map(async exchange => ({
            protocol: exchange.protocol,
            type: exchange.type,
            address: await zapManagerContract.protocolImplementations(exchange.protocol),
        })),
    )

    await saveAddress('StrategyInvestor', strategyInvestor)
    await saveAddress('StrategyPositionManager', strategyPositionManager)
    await saveAddress('StrategyManager', strategyManager.proxy)
    await saveAddress('SubscriptionManager', subscriptionManager.proxy)
    await saveAddress('ZapManager', zapManager.proxy)
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
        zapManager,
    ]

    const implementations = [
        ...contractAddresses.map(({ implementation }) => implementation),
        strategyInvestor,
        strategyPositionManager,
    ]

    for (const zapProtocolImplementation of zapProtocolImplementations) {
        await saveAddress(`ZapProtocol:${ zapProtocolImplementation.protocol }`, zapProtocolImplementation.address)

        await verify(
            zapProtocolImplementation.address,
            [
                zapProtocolImplementation.type === ExchangeTypes.UniswapV2
                    ? {
                        treasury: TREASURY_ADDR,
                        swapRouter: await ZapperUniswapV2__factory
                            .connect(zapProtocolImplementation.address, deployer)
                            .swapRouter(),
                    }
                    : {
                        swapRouter: await SwapperUniswapV3__factory
                            .connect(zapProtocolImplementation.address, deployer)
                            .swapRouter(),
                    },
            ],
        )
    }

    for (const address of implementations)
        await verify(address)

    for (const address of contractAddresses) {
        await verify(
            address.proxy,
            [address.implementation, '0x'],
        )
    }

    await upgrade(await findAddressOrFail('DollarCostAverage'), 'DollarCostAverage__NoDeadline')
}

deployProject()
