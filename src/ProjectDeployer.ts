import { sendLocalDeploymentTransaction } from '@src/helpers'
import { ethers } from 'hardhat'
import {
    ProjectDeployer__factory,
    DollarCostAverage,
    SubscriptionManager,
    DollarCostAverage__factory,
    SubscriptionManager__factory,
    StrategyManager__factory,
    VaultManager__factory,
    StrategyManager,
    VaultManager,
    UniswapV3Factory__factory,
    SwapRouter__factory,
    TestERC20__factory,
    TestERC20,
    NonFungiblePositionManager__factory,
    ZapManager,
    ZapManager__factory,
    UniswapV2Factory__factory,
    UniswapV2Router02__factory,
    Quoter__factory,
    StrategyInvestor__factory,
    LiquidityManager,
    LiquidityManager__factory,
    BuyProduct,
    BuyProduct__factory,
    StrategyPositionManager__factory,
} from '@src/typechain'
import { ZeroHash, ZeroAddress, Signer } from 'ethers'
import { NetworkService } from '@src/NetworkService'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { ZapProtocols } from '@defihub/shared'

export class ProjectDeployer {
    private hashCount = 0

    public async deployProjectFixture() {
        const [
            deployer,
            owner,
            swapper,
            treasury,
            subscriptionSigner,

            account0,
            account1,
            account2,
        ] = await ethers.getSigners()

        const subscriptionMonthlyPrice = ethers.parseEther('4.69')
        const projectDeployerFactory = new ProjectDeployer__factory(deployer)
        const projectDeployer = await projectDeployerFactory.deploy()

        const stablecoin = await new TestERC20__factory(deployer).deploy(18)
        // Originally USDC uses 6 decimals, thats why the name choice
        const usdc = await new TestERC20__factory(deployer).deploy(6)
        const weth = await new TestERC20__factory(deployer).deploy(18)
        const wbtc = await new TestERC20__factory(account0).deploy(18)
        const { factoryUniV2, routerUniV2 } = await this.deployUniV2(deployer, weth)
        const {
            factoryUniV3,
            routerUniV3,
            positionManagerUniV3,
            quoterUniV3,
        } = await this.deployUniV3(deployer, weth)

        const subscriptionManagerDeployParams = this.getDeploymentInfo(SubscriptionManager__factory)
        const strategyManagerDeployParams = this.getDeploymentInfo(StrategyManager__factory)
        const dcaDeployParams = this.getDeploymentInfo(DollarCostAverage__factory)
        const vaultManagerDeployParams = this.getDeploymentInfo(VaultManager__factory)
        const liquidityManagerDeployParams = this.getDeploymentInfo(LiquidityManager__factory)
        const zapManagerDeployParams = this.getDeploymentInfo(ZapManager__factory)
        const buyProductDeployParams = this.getDeploymentInfo(BuyProduct__factory)

        await projectDeployer.deployStrategyInvestor(StrategyInvestor__factory.bytecode, ZeroHash)
        await projectDeployer.deployStrategyPositionManager(StrategyPositionManager__factory.bytecode, ZeroHash)
        await projectDeployer.deploySubscriptionManager(subscriptionManagerDeployParams)
        await projectDeployer.deployStrategyManager(strategyManagerDeployParams)
        await projectDeployer.deployDca(dcaDeployParams)
        await projectDeployer.deployVaultManager(vaultManagerDeployParams)
        await projectDeployer.deployLiquidityManager(liquidityManagerDeployParams)
        await projectDeployer.deployZapManager(zapManagerDeployParams)
        await projectDeployer.deployBuyProduct(buyProductDeployParams)

        // non-proxy contracts
        const [
            strategyInvestor,
            strategyPositionManager,
        ] = await Promise.all([
            projectDeployer.strategyInvestor(),
            projectDeployer.strategyPositionManager(),
        ])

        // proxy contracts
        const [
            strategyManager,
            subscriptionManagerAddress,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
            zapManager,
        ] = (await Promise.all([
            projectDeployer.strategyManager(),
            projectDeployer.subscriptionManager(),
            projectDeployer.dca(),
            projectDeployer.vaultManager(),
            projectDeployer.liquidityManager(),
            projectDeployer.buyProduct(),
            projectDeployer.zapManager(),
        ])).map(({ proxy }) => proxy)

        const subscriptionManager = SubscriptionManager__factory.connect(
            subscriptionManagerAddress,
            owner,
        )

        const subscriptionManagerInitParams: SubscriptionManager.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            subscriptionSigner: subscriptionSigner.address,
            token: stablecoin,
            pricePerMonth: subscriptionMonthlyPrice,
        }

        const strategyManagerInitParams: StrategyManager.InitializeParamsStruct = {
            owner,
            treasury,
            strategyInvestor,
            strategyPositionManager,
            stable: stablecoin,
            subscriptionManager,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
            zapManager,
            maxHottestStrategies: 10n,
            strategistPercentage: 20n,
            hotStrategistPercentage: 40n,
        }

        const dcaInitParams: DollarCostAverage.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            swapper: swapper.address,
            strategyManager,
            subscriptionManager,
            baseFeeBP: 70n,
            nonSubscriberFeeBP: 30n,
        }

        const vaultManagerInit: VaultManager.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            strategyManager,
            subscriptionManager,
            baseFeeBP: 70n,
            nonSubscriberFeeBP: 30n,
        }

        const liquidityManagerInit: LiquidityManager.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            strategyManager,
            subscriptionManager,
            zapManager,
            baseFeeBP: 30n,
            nonSubscriberFeeBP: 30n,
        }

        const buyProductManagerInit: BuyProduct.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            subscriptionManager,
            baseFeeBP: 30n,
            nonSubscriberFeeBP: 30n,
        }

        const zapManagerInit: ZapManager.InitializeParamsStruct = {
            owner: owner.address,
            zappersUniswapV2: [
                {
                    name: ZapProtocols.UniswapV2,
                    constructorParams: {
                        treasury: treasury,
                        swapRouter: routerUniV2,
                    },
                },
            ],
            swappersUniswapV3: [
                {
                    name: ZapProtocols.UniswapV3,
                    constructorParams: {
                        positionManager: positionManagerUniV3,
                        swapRouter: routerUniV3,
                    },
                },
            ],
        }

        await projectDeployer.initializeProject(
            subscriptionManagerInitParams,
            strategyManagerInitParams,
            dcaInitParams,
            vaultManagerInit,
            liquidityManagerInit,
            buyProductManagerInit,
            zapManagerInit,
        )

        const subscriptionSignature= new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        )
        const deadline = await NetworkService.getBlockTimestamp() + 10_000

        return {
            // Contracts
            strategyPositionManager: StrategyPositionManager__factory.connect(strategyPositionManager, owner),
            strategyManager: StrategyManager__factory.connect(strategyManager, owner),
            subscriptionManager,
            dca: DollarCostAverage__factory.connect(dca, owner),
            vaultManager: VaultManager__factory.connect(vaultManager, owner),
            zapManager: ZapManager__factory.connect(zapManager, owner),
            buyProduct: BuyProduct__factory.connect(buyProduct, owner),
            liquidityManager: LiquidityManager__factory.connect(liquidityManager, owner),

            // EOA with contract roles
            deployer,
            owner,
            swapper,
            treasury,
            subscriptionSigner,

            // Test EOA
            account0,
            account1,
            account2,

            // Constants
            subscriptionMonthlyPrice,
            subscriptionManagerInitParams,
            strategyManagerInitParams,
            dcaInitParams,
            vaultManagerInit,

            // Test contracts
            stablecoin,
            usdc,
            weth,
            wbtc,
            factoryUniV2,
            routerUniV2,
            factoryUniV3,
            routerUniV3,
            positionManagerUniV3,
            quoterUniV3,

            subscriptionSignature,
            deadline,
            /** strategist Permit */
            permitAccount0: await subscriptionSignature
                .signSubscriptionPermit(await account0.getAddress(), deadline),
            expiredPermitAccount0: await subscriptionSignature
                .signSubscriptionPermit(await account0.getAddress(), 0),
        }
    }

    private async deployUniV2(deployer: Signer, weth: TestERC20) {
        const factoryUniV2 = UniswapV2Factory__factory.connect(
            await sendLocalDeploymentTransaction(
                UniswapV2Factory__factory.bytecode + UniswapV2Factory__factory
                    .createInterface()
                    .encodeDeploy([await deployer.getAddress()])
                    .replace('0x', ''),
                deployer,
            ),
            deployer,
        )

        const routerUniV2 = UniswapV2Router02__factory.connect(
            await sendLocalDeploymentTransaction(
                UniswapV2Router02__factory.bytecode + UniswapV2Router02__factory
                    .createInterface()
                    .encodeDeploy([await factoryUniV2.getAddress(), await weth.getAddress()])
                    .replace('0x', ''),
                deployer,
            ),
            deployer,
        )

        return {
            factoryUniV2,
            routerUniV2,
        }
    }

    private async deployUniV3(deployer: Signer, weth: TestERC20) {
        const factoryUniV3 = await new UniswapV3Factory__factory(deployer).deploy()

        const positionManagerUniV3 = await new NonFungiblePositionManager__factory(deployer).deploy(
            factoryUniV3,
            weth,
            ZeroAddress, // Token descriptor address is not used in tests
        )

        const routerUniV3 = await new SwapRouter__factory(deployer).deploy(factoryUniV3, weth)

        const quoterUniV3 = await new Quoter__factory(deployer).deploy(factoryUniV3, weth)

        return {
            factoryUniV3,
            routerUniV3,
            positionManagerUniV3,
            quoterUniV3,
        }
    }

    private getDeploymentInfo<T>(contract: T & { bytecode: string }) {
        return {
            code: contract.bytecode,
            proxySalt: this.getTestHash(),
            implementationSalt: this.getTestHash(),
        }
    }

    private getTestHash() {
        this.hashCount++

        return ZeroHash.replace('0x0', `0x${ this.hashCount }`).substring(0, 66)
    }
}
