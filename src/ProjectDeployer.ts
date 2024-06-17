import { sendLocalTransaction, sendLocalDeploymentTransaction } from '@src/helpers'
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
} from '@src/typechain'
import { ZeroHash, ZeroAddress, Signer, AddressLike } from 'ethers'

export class ProjectDeployer {
    private hashCount = 0

    constructor(
        private subscriptionDepositToken: AddressLike,
        private strategyDepositToken: AddressLike,
    ) {
    }

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

        const weth = await new TestERC20__factory(deployer).deploy()
        const wbtc = await new TestERC20__factory(account0).deploy()
        const { factoryUniV2, routerUniV2 } = await this.deployUniV2(deployer, weth)
        const {
            factoryUniV3,
            routerUniV3,
            positionManagerUniV3,
            quoterUniV3,
        } = await this.deployUniV3(deployer, weth)
        const investLib = await new InvestLib__factory(deployer).deploy()

        const subscriptionManagerDeployParams = this.getDeploymentInfo(SubscriptionManager__factory)
        const strategyManagerDeployParams = this.getDeploymentInfo(StrategyManager__factory)
        const dcaDeployParams = this.getDeploymentInfo(DollarCostAverage__factory)
        const vaultManagerDeployParams = this.getDeploymentInfo(VaultManager__factory)
        const liquidityManagerDeployParams = this.getDeploymentInfo(LiquidityManager__factory)
        const zapManagerDeployParams = this.getDeploymentInfo(ZapManager__factory)

        await sendLocalTransaction(
            await projectDeployer.deploySubscriptionManager
                .populateTransaction(subscriptionManagerDeployParams),
            deployer,
        )
        await sendLocalTransaction(
            await projectDeployer.deployStrategyManager
                .populateTransaction(strategyManagerDeployParams),
            deployer,
        )
        await sendLocalTransaction(
            await projectDeployer.deployDca
                .populateTransaction(dcaDeployParams),
            deployer,
        )
        await sendLocalTransaction(
            await projectDeployer.deployVaultManager
                .populateTransaction(vaultManagerDeployParams),
            deployer,
        )
        await sendLocalTransaction(
            await projectDeployer.deployLiquidityManager
                .populateTransaction(liquidityManagerDeployParams),
            deployer,
        )
        await sendLocalTransaction(
            await projectDeployer.deployZapManager
                .populateTransaction(zapManagerDeployParams),
            deployer,
        )

        const subscriptionManagerInitParams: SubscriptionManager.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            subscriptionSigner: subscriptionSigner.address,
            token: this.subscriptionDepositToken,
            pricePerMonth: subscriptionMonthlyPrice,
        }

        const strategyManagerInitParams: StrategyManager.InitializeParamsStruct = {
            owner,
            treasury,
            investLib,
            stable: this.strategyDepositToken,
            subscriptionManager: ZeroAddress,
            dca: ZeroAddress,
            vaultManager: ZeroAddress,
            liquidityManager: ZeroAddress,
            zapManager: ZeroAddress,
            maxHottestStrategies: 10n,
            strategistPercentage: 20n,
            hotStrategistPercentage: 40n,
        }

        const dcaInitParams: DollarCostAverage.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            swapper: swapper.address,
            strategyManager: ZeroAddress,
            subscriptionManager: ZeroAddress,
            baseFeeBP: 70n,
            nonSubscriberFeeBP: 30n,
        }

        const vaultManagerInit: VaultManager.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            strategyManager: ZeroAddress,
            subscriptionManager: ZeroAddress,
            baseFeeBP: 70n,
            nonSubscriberFeeBP: 30n,
        }

        const liquidityManagerInit: LiquidityManager.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            subscriptionManager: ZeroAddress,
            strategyManager: ZeroAddress,
            zapManager: ZeroAddress,
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

        await sendLocalTransaction(
            await projectDeployer.initializeProject.populateTransaction(
                subscriptionManagerInitParams,
                strategyManagerInitParams,
                dcaInitParams,
                vaultManagerInit,
                liquidityManagerInit,
                zapManagerInit,
            ),
            deployer,
        )

        const [
            strategyManager,
            subscriptionManager,
            dca,
            vaultManager,
            zapManager,
            liquidityManager,
        ] = (await Promise.all([
            projectDeployer.strategyManager(),
            projectDeployer.subscriptionManager(),
            projectDeployer.dca(),
            projectDeployer.vaultManager(),
            projectDeployer.zapManager(),
            projectDeployer.liquidityManager(),
        ])).map(({ proxy }) => proxy)

        return {
            // Contracts
            strategyManager: StrategyManager__factory.connect(strategyManager, owner),
            subscriptionManager: SubscriptionManager__factory.connect(subscriptionManager, owner),
            dca: DollarCostAverage__factory.connect(dca, owner),
            vaultManager: VaultManager__factory.connect(vaultManager, owner),
            zapManager: ZapManager__factory.connect(zapManager, owner),
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
            weth,
            wbtc,
            factoryUniV2,
            routerUniV2,
            factoryUniV3,
            routerUniV3,
            positionManagerUniV3,
            quoterUniV3,
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
