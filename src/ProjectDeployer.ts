import { sendLocalDeploymentTransaction } from '@src/helpers'
import { ethers } from 'hardhat'
import {
    ProjectDeployer__factory,
    ProjectDeployer as ProjectDeployerContract,
    DollarCostAverage,
    SubscriptionManager,
    DollarCostAverage__factory,
    SubscriptionManager__factory,
    VaultManager__factory,
    StrategyManager,
    VaultManager,
    UniswapV3Factory__factory,
    SwapRouter__factory,
    TestERC20__factory,
    TestERC20,
    NonFungiblePositionManager__factory,
    UniswapV2Factory__factory,
    UniswapV2Router02__factory,
    Quoter__factory,
    StrategyInvestor__factory,
    LiquidityManager,
    LiquidityManager__factory,
    BuyProduct,
    BuyProduct__factory,
    StrategyPositionManager__factory,
    UniversalRouter__factory,
    UniswapV3Factory,
    NonFungiblePositionManager,
    UniswapV2Factory,
    TestWETH__factory,
    StrategyManager__v4__factory,
} from '@src/typechain'
import { ZeroHash, ZeroAddress, Signer, parseEther } from 'ethers'
import { NetworkService } from '@src/NetworkService'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { POOL_INIT_CODE_HASH } from '@uniswap/v3-sdk'
import { YEAR_IN_SECONDS } from '@src/constants'

export class ProjectDeployer {
    private hashCount = 0

    public async deployProjectFixture() {
        const {
            deployer,
            owner,
            swapper,
            treasury,
            subscriptionSigner,

            account0,
            account1,
            account2,
            account3,
        } = await this.getAccounts()

        const subscriptionMonthlyPrice = parseEther('4.69')
        const projectDeployerFactory = new ProjectDeployer__factory(deployer)
        const projectDeployer = await projectDeployerFactory.deploy()

        const { stablecoin, usdc, weth, wbtc } = await this.deployTokens(deployer)
        const { factoryUniV2, routerUniV2 } = await this.deployUniV2(deployer, weth)

        const {
            factoryUniV3,
            routerUniV3,
            positionManagerUniV3,
            quoterUniV3,
        } = await this.deployUniV3(deployer, weth)

        const universalRouter = await this.deployUniversalRouter(
            deployer,
            weth,
            factoryUniV2,
            factoryUniV3,
            positionManagerUniV3,
        )

        await this.deployProducts(projectDeployer, stablecoin, subscriptionMonthlyPrice)

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
        ] = (await Promise.all([
            projectDeployer.strategyManager(),
            projectDeployer.subscriptionManager(),
            projectDeployer.dca(),
            projectDeployer.vaultManager(),
            projectDeployer.liquidityManager(),
            projectDeployer.buyProduct(),
        ])).map(({ proxy }) => proxy)

        const subscriptionManager = SubscriptionManager__factory.connect(
            subscriptionManagerAddress,
            owner,
        )

        // Set referrer percentage to 1%
        await StrategyManager__v4__factory
            .connect(strategyManager, owner)
            .initialize__v2(strategyInvestor, strategyPositionManager, 1)

        // Set referral duration to 3 years
        await StrategyManager__v4__factory
            .connect(strategyManager, owner)
            .initialize__v3(
                strategyInvestor,
                YEAR_IN_SECONDS * 3,
            )

        await StrategyManager__v4__factory
            .connect(strategyManager, owner)
            .initialize__v4(
                strategyPositionManager,
                1e6, // 100%
            )

        const subscriptionSignature = new SubscriptionSignature(
            subscriptionManager,
            subscriptionSigner,
        )
        const deadline = await NetworkService.getBlockTimestamp() + 10_000

        return {
            // Contracts
            strategyPositionManager: StrategyPositionManager__factory.connect(strategyPositionManager, owner),
            strategyManager: StrategyManager__v4__factory.connect(strategyManager, owner),
            subscriptionManager,
            dca: DollarCostAverage__factory.connect(dca, owner),
            vaultManager: VaultManager__factory.connect(vaultManager, owner),
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
            account3,

            // Constants
            subscriptionMonthlyPrice,

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
            universalRouter,

            subscriptionSignature,
            deadline,
            /** strategist Permit */
            permitAccount0: await subscriptionSignature
                .signSubscriptionPermit(await account0.getAddress(), deadline),
            permitAccount3: await subscriptionSignature
                .signSubscriptionPermit(await account3.getAddress(), deadline),
            expiredPermitAccount0: await subscriptionSignature
                .signSubscriptionPermit(await account0.getAddress(), 0),
        }
    }

    private async deployProducts(
        projectDeployer: ProjectDeployerContract,
        stablecoin: TestERC20,
        subscriptionMonthlyPrice: bigint,
    ) {
        const dcaDeployParams = this.getDeploymentInfo(DollarCostAverage__factory)
        const buyProductDeployParams = this.getDeploymentInfo(BuyProduct__factory)
        const vaultManagerDeployParams = this.getDeploymentInfo(VaultManager__factory)
        const liquidityManagerDeployParams = this.getDeploymentInfo(LiquidityManager__factory)
        const strategyManagerDeployParams = this.getDeploymentInfo(StrategyManager__v4__factory)
        const subscriptionManagerDeployParams = this.getDeploymentInfo(SubscriptionManager__factory)

        const {
            owner,
            swapper,
            treasury,
            subscriptionSigner,
        } = await this.getAccounts()

        const subscriptionManagerInitParams: SubscriptionManager.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            subscriptionSigner: subscriptionSigner.address,
            token: stablecoin,
            pricePerMonth: subscriptionMonthlyPrice,
        }

        const [
            strategyInvestor,
            strategyPositionManager,
        ] = await Promise.all([
            projectDeployer.getDeployAddress(StrategyInvestor__factory.bytecode, ZeroHash),
            projectDeployer.getDeployAddress(StrategyPositionManager__factory.bytecode, ZeroHash),
        ])

        const [
            subscriptionManager,
            strategyManager,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
        ] = (await Promise.all([
            projectDeployer.getDeployProxyAddress(subscriptionManagerDeployParams),
            projectDeployer.getDeployProxyAddress(strategyManagerDeployParams),
            projectDeployer.getDeployProxyAddress(dcaDeployParams),
            projectDeployer.getDeployProxyAddress(vaultManagerDeployParams),
            projectDeployer.getDeployProxyAddress(liquidityManagerDeployParams),
            projectDeployer.getDeployProxyAddress(buyProductDeployParams),
        ])).map(({ proxy }) => proxy)

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
            zapManager: ZeroAddress,
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
            zapManager: ZeroAddress,
            baseFeeBP: 30n,
            nonSubscriberFeeBP: 30n,
        }

        const buyInitParams: BuyProduct.InitializeParamsStruct = {
            owner: owner.address,
            treasury: treasury.address,
            subscriptionManager,
            baseFeeBP: 30n,
            nonSubscriberFeeBP: 30n,
        }

        await projectDeployer.deployDca(dcaDeployParams, dcaInitParams)
        await projectDeployer.deployBuyProduct(buyProductDeployParams, buyInitParams)
        await projectDeployer.deployVaultManager(vaultManagerDeployParams, vaultManagerInit)
        await projectDeployer.deployLiquidityManager(liquidityManagerDeployParams, liquidityManagerInit)

        await projectDeployer.deployStrategyInvestor(StrategyInvestor__factory.bytecode, ZeroHash)
        await projectDeployer.deployStrategyPositionManager(StrategyPositionManager__factory.bytecode, ZeroHash)
        await projectDeployer.deploySubscriptionManager(subscriptionManagerDeployParams, subscriptionManagerInitParams)
        await projectDeployer.deployStrategyManager(strategyManagerDeployParams, strategyManagerInitParams)
    }

    private async deployTokens(deployer: Signer) {
        const weth = await new TestWETH__factory(deployer).deploy()
        const wbtc = await new TestERC20__factory(deployer).deploy(18)

        // Originally USDC uses 6 decimals, that's why the name choice
        const usdc = await new TestERC20__factory(deployer).deploy(6)
        const stablecoin = await new TestERC20__factory(deployer).deploy(18)

        return {
            weth,
            wbtc,
            usdc,
            stablecoin,
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

    private async deployUniversalRouter(
        deployer: Signer,
        weth: TestERC20,
        factoryV2: UniswapV2Factory,
        factoryV3: UniswapV3Factory,
        positionManagerV3: NonFungiblePositionManager,
    ) {
        /**
         * Multiple addresses are set to the zero address, effectively disabling those integrations.
         * This is sufficient for our current testing setup, where these integrations aren't required.
         * If you need to test or deploy a specific integration, deploy and update the relevant address accordingly.
         */
        return new UniversalRouter__factory(deployer).deploy({
            // utils
            weth9: weth,
            permit2: ZeroAddress,
            // v2
            v2Factory: factoryV2,
            pairInitCodeHash: '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f', // official uni hash
            // v3
            v3Factory: factoryV3,
            v3NFTPositionManager: positionManagerV3,
            poolInitCodeHash: POOL_INIT_CODE_HASH,
            // v4
            v4PositionManager: ZeroAddress,
            v4PoolManager: ZeroAddress,
        })
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

    private async getAccounts() {
        const [
            deployer,
            owner,
            swapper,
            treasury,
            subscriptionSigner,

            account0,
            account1,
            account2,
            account3,
        ] = await ethers.getSigners()

        return {
            deployer,
            owner,
            swapper,
            treasury,
            subscriptionSigner,
            account0,
            account1,
            account2,
            account3,
        }
    }
}
