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
    InvestLib__factory,
    LiquidityManager,
    LiquidityManager__factory,
    ExchangeManager__factory,
    ExchangeManager,
} from '@src/typechain'
import { ZeroHash, ZeroAddress, Signer } from 'ethers'
import { NetworkService } from '@src/NetworkService'
import { SubscriptionSignature } from '@src/SubscriptionSignature'

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

        const stablecoin = await new TestERC20__factory(deployer).deploy()
        const weth = await new TestERC20__factory(deployer).deploy()
        const wbtc = await new TestERC20__factory(account0).deploy()
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
        const exchangeManagerDeployParams = this.getDeploymentInfo(ExchangeManager__factory)

        await projectDeployer.deployInvestLib(InvestLib__factory.bytecode, ZeroHash)
        await projectDeployer.deploySubscriptionManager(subscriptionManagerDeployParams)
        await projectDeployer.deployStrategyManager(strategyManagerDeployParams)
        await projectDeployer.deployDca(dcaDeployParams)
        await projectDeployer.deployVaultManager(vaultManagerDeployParams)
        await projectDeployer.deployLiquidityManager(liquidityManagerDeployParams)
        await projectDeployer.deployZapManager(zapManagerDeployParams)
        await projectDeployer.deployExchangeManager(exchangeManagerDeployParams)

        const investLib = await projectDeployer.investLib()
        const [
            strategyManager,
            subscriptionManagerAddress,
            dca,
            vaultManager,
            liquidityManager,
            exchangeManager,
            zapManager,
        ] = (await Promise.all([
            projectDeployer.strategyManager(),
            projectDeployer.subscriptionManager(),
            projectDeployer.dca(),
            projectDeployer.vaultManager(),
            projectDeployer.liquidityManager(),
            projectDeployer.exchangeManager(),
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
            investLib,
            stable: stablecoin,
            subscriptionManager,
            dca,
            vaultManager,
            liquidityManager,
            exchangeManager,
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

        const exchangeManagerInit: ExchangeManager.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            subscriptionManager,
            baseFeeBP: 30n,
            nonSubscriberFeeBP: 30n,
        }

        const zapManagerInit: ZapManager.InitializeParamsStruct = {
            owner: owner.address,
            uniswapV2ZapperConstructor: {
                treasury: treasury,
                swapRouter: routerUniV2,
            },
            uniswapV3ZapperConstructor: {
                positionManager: positionManagerUniV3,
                swapRouter: routerUniV3,
            },
        }

        await projectDeployer.initializeProject(
            subscriptionManagerInitParams,
            strategyManagerInitParams,
            dcaInitParams,
            vaultManagerInit,
            liquidityManagerInit,
            exchangeManagerInit,
            zapManagerInit,
        )

        const subscriptionSignature= new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        )
        const deadline = await NetworkService.getBlockTimestamp() + 10_000

        return {
            // Contracts
            strategyManager: StrategyManager__factory.connect(strategyManager, owner),
            subscriptionManager,
            dca: DollarCostAverage__factory.connect(dca, owner),
            vaultManager: VaultManager__factory.connect(vaultManager, owner),
            zapManager: ZapManager__factory.connect(zapManager, owner),
            exchangeManager: ExchangeManager__factory.connect(exchangeManager, owner),
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
            /** Strategiest Permit */
            permitAccount0: await subscriptionSignature
                .signSubscriptionPermit(await account0.getAddress(), deadline),
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
