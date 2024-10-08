import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    UniswapV2,
    UniswapV2ZapHelper,
    UniswapV3ZapHelper,
} from '@src/helpers'
import {
    BeefyMockStrategy__factory,
    BeefyVaultV7__factory,
    DollarCostAverage,
    BuyProduct,
    LiquidityManager,
    StrategyManager,
    SubscriptionManager,
    TestERC20,
    UniswapV2Factory,
    UniswapV2Pair,
    VaultManager,
    ZapManager,
} from '@src/typechain'
import { expect } from 'chai'
import { AddressLike, parseEther, Signer, ZeroHash } from 'ethers'
import hre from 'hardhat'
import { PathUniswapV3 } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { Compare } from '@src/Compare'
import { zapFixture } from './fixtures/zap.fixture'
import { decodeLowLevelCallError } from '@src/helpers'
import { Fees } from '@src/helpers/Fees'
import { mockTokenWithAddress } from '@src/helpers/mock-token'

describe('StrategyManager#invest (zap)', () => {
    const amount = parseEther('1000')
    const INSUFFICIENT_OUTPUT_AMOUNT = 'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'

    // prices
    let USD_PRICE_BN: BigNumber
    let BTC_PRICE: bigint
    let BTC_PRICE_BN: BigNumber
    let ETH_PRICE: bigint
    let ETH_PRICE_BN: BigNumber

    // accounts
    let account0: Signer
    let treasury: Signer

    // tokens
    let stablecoin: TestERC20
    let weth: TestERC20
    let wbtc: TestERC20

    // hub contracts
    let strategyManager: StrategyManager
    let dca: DollarCostAverage
    let vaultManager: VaultManager
    let liquidityManager: LiquidityManager
    let buyProduct: BuyProduct
    let zapManager: ZapManager

    // external test contracts
    let factoryUniV2: UniswapV2Factory

    // global data
    let strategyId: bigint
    let stableBtcPoolId: bigint
    let btcEthPoolId: bigint
    let initialTreasuryBalance: bigint
    let permitAccount0: SubscriptionManager.PermitStruct
    let btcEthLpUniV2: UniswapV2Pair

    async function createVault(token: AddressLike) {
        const [deployer] = await hre.ethers.getSigners()
        const strategy = await new BeefyMockStrategy__factory(deployer).deploy()
        const vault = await new BeefyVaultV7__factory(deployer).deploy()

        await vault.initialize(strategy, 'Mock Vault', 'mooMV', 0)
        await strategy.initialize(vault, token)

        return vault
    }

    function getStrategyFeeAmount(amount: bigint) {
        return Fees.getStrategyFeeAmount(
            amount,
            strategyManager,
            strategyId,
            true,
            true,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
        )
    }

    function deductStrategyFee(amount: bigint) {
        return Fees.deductStrategyFee(
            amount,
            strategyManager,
            strategyId,
            true,
            true,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
        )
    }

    beforeEach(async () => {
        ({
            // accounts
            account0,
            treasury,

            // tokens
            stablecoin,
            weth,
            wbtc,

            // hub contracts
            strategyManager,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
            zapManager,

            // external test contracts
            factoryUniV2,

            // global data
            strategyId,
            stableBtcPoolId,
            btcEthPoolId,
            initialTreasuryBalance,
            permitAccount0,
            btcEthLpUniV2,

            // constants
            USD_PRICE_BN,
            BTC_PRICE,
            BTC_PRICE_BN,
            ETH_PRICE,
            ETH_PRICE_BN,
        } = await loadFixture(zapFixture))
    })

    describe('zaps into DCA strategy', () => {
        async function validateDcaZap(tolerance: BigNumber) {
            await strategyManager.connect(account0).closePosition(0, [])

            Compare.almostEqualPercentage({
                target: amount * 50n / 100n,
                value: await stablecoin.balanceOf(account0),
                tolerance,
            })

            Compare.almostEqualPercentage({
                target: amount * 50n / 100n / BTC_PRICE,
                value: await wbtc.balanceOf(account0),
                tolerance,
            })

            const { protocolFee, strategistFee } = await getStrategyFeeAmount(amount)

            expect(await stablecoin.balanceOf(treasury)).to.equal(initialTreasuryBalance + protocolFee)
            expect(await stablecoin.balanceOf(zapManager)).to.equal(0)
            expect(await stablecoin.balanceOf(dca)).to.equal(0)
            expect(await stablecoin.balanceOf(strategyManager)).to.equal(strategistFee)
        }

        let amountPerInvestmentMinusFees: bigint

        beforeEach(async () => {
            await strategyManager.connect(account0).createStrategy({
                dcaInvestments: [
                    {
                        poolId: stableBtcPoolId,
                        swaps: 10,
                        percentage: 50n,
                    },
                    {
                        poolId: btcEthPoolId,
                        swaps: 10,
                        percentage: 50n,
                    },
                ],
                vaultInvestments: [],
                liquidityInvestments: [],
                buyInvestments: [],
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

            await stablecoin.connect(account0).mint(account0, amount)
            await stablecoin.connect(account0).approve(strategyManager, amount)

            amountPerInvestmentMinusFees = await deductStrategyFee(amount * 50n / 100n)
        })

        it('zaps with 1% slippage uni v2', async () => {
            await strategyManager
                .connect(account0)
                .invest({
                    strategyId,
                    inputToken: stablecoin,
                    inputAmount: amount,
                    inputTokenSwap: '0x',
                    dcaSwaps: [
                        '0x',
                        await UniswapV2ZapHelper.encodeSwap(
                            amountPerInvestmentMinusFees,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                            strategyManager,
                        ),
                    ],
                    vaultSwaps: [],
                    buySwaps: [],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await validateDcaZap(new BigNumber(0.01))
        })

        it('zaps with 1% slippage uni v3 single-hop', async () => {
            await strategyManager
                .connect(account0)
                .invest({
                    strategyId,
                    inputToken: stablecoin,
                    inputAmount: amount,
                    inputTokenSwap: '0x',
                    dcaSwaps: [
                        '0x',
                        await UniswapV3ZapHelper.encodeExactInputSingle(
                            amountPerInvestmentMinusFees,
                            await mockTokenWithAddress(USD_PRICE_BN, 18, stablecoin),
                            await mockTokenWithAddress(BTC_PRICE_BN, 18, wbtc),
                            3000,
                            new BigNumber(0.01),
                            strategyManager,
                        ),
                    ],
                    vaultSwaps: [],
                    buySwaps: [],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await validateDcaZap(new BigNumber(0.01))
        })

        it('zaps with 1% slippage uni v3 multi-hop', async () => {
            await strategyManager
                .connect(account0)
                .invest({
                    strategyId,
                    inputToken: stablecoin,
                    inputAmount: amount,
                    inputTokenSwap: '0x',
                    dcaSwaps: [
                        '0x',
                        await UniswapV3ZapHelper.encodeExactInput(
                            amountPerInvestmentMinusFees,
                            new PathUniswapV3(
                                stablecoin,
                                [
                                    { token: weth, fee: 3000 },
                                    { token: wbtc, fee: 3000 },
                                ],
                            ),
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.05),
                            strategyManager,
                        ),
                    ],
                    vaultSwaps: [],
                    buySwaps: [],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await validateDcaZap(new BigNumber(0.015)) // 1.5% because of multi-hop
        })

        it('fails with 0% slippage', async () => {
            const amountPerInvestmentMinusFees = await deductStrategyFee(amount * 50n / 100n)

            try {
                await strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amount,
                        inputTokenSwap: '0x',
                        dcaSwaps: [
                            '0x',
                            await UniswapV2ZapHelper.encodeSwap(
                                amountPerInvestmentMinusFees,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                                strategyManager,
                            ),
                        ],
                        vaultSwaps: [],
                        buySwaps: [],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    })

                throw new Error('Expected to fail')
            }
            catch (e) {
                const error = decodeLowLevelCallError(e)

                expect(error).to.equal(INSUFFICIENT_OUTPUT_AMOUNT)
            }
        })
    })

    describe('zaps into Vault strategy', () => {
        let initialLpBalance: bigint
        let amountPerInvestmentMinusFees: bigint

        beforeEach(async () => {
            initialLpBalance = await btcEthLpUniV2.balanceOf(account0)

            await strategyManager.connect(account0).createStrategy({
                dcaInvestments: [],
                vaultInvestments: [
                    {
                        vault: await createVault(wbtc),
                        percentage: 50n,
                    },
                    {
                        vault: await createVault(await factoryUniV2.getPair(wbtc, weth)),
                        percentage: 50n,
                    },
                ],
                liquidityInvestments: [],
                buyInvestments: [],
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

            await stablecoin.connect(account0).mint(account0, amount)
            await stablecoin.connect(account0).approve(strategyManager, amount)

            amountPerInvestmentMinusFees = await deductStrategyFee(amount * 50n / 100n)
        })

        it('zaps with 1% slippage', async () => {
            await strategyManager
                .connect(account0)
                .invest({
                    strategyId,
                    inputToken: stablecoin,
                    inputAmount: amount,
                    inputTokenSwap: '0x',
                    dcaSwaps: [],
                    vaultSwaps: [
                        await UniswapV2ZapHelper.encodeSwap(
                            amountPerInvestmentMinusFees,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                            strategyManager,
                        ),
                        await UniswapV2ZapHelper.encodeZap(
                            amountPerInvestmentMinusFees,
                            stablecoin,
                            wbtc,
                            weth,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            ETH_PRICE_BN,
                            new BigNumber(0.01),
                            zapManager,
                            factoryUniV2,
                        ),
                    ],
                    buySwaps: [],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await strategyManager.connect(account0).closePosition(0, [])

            Compare.almostEqualPercentage({
                target: amount * 50n / 100n / BTC_PRICE,
                value: await wbtc.balanceOf(account0),
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })

            const amountPerToken = amount * 50n / 100n / 2n
            const amountA = amountPerToken / BTC_PRICE
            const amountB = amountPerToken / ETH_PRICE

            Compare.almostEqualPercentage({
                target: await UniswapV2.estimateLiquidityOutput(amountA, amountB),
                value: await btcEthLpUniV2.balanceOf(account0) - initialLpBalance,
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })
        })

        it('fails with 0% slippage', async () => {
            try {
                await strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amount,
                        inputTokenSwap: '0x',
                        dcaSwaps: [],
                        vaultSwaps: [
                            await UniswapV2ZapHelper.encodeSwap(
                                amountPerInvestmentMinusFees,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                                strategyManager,
                            ),
                            await UniswapV2ZapHelper.encodeZap(
                                amountPerInvestmentMinusFees,
                                stablecoin,
                                wbtc,
                                weth,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                ETH_PRICE_BN,
                                new BigNumber(0),
                                zapManager,
                                factoryUniV2,
                            ),
                        ],
                        buySwaps: [],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    })

                throw new Error('Expected to fail')
            }
            catch (e) {
                const error = decodeLowLevelCallError(e)

                expect(error).to.equal(INSUFFICIENT_OUTPUT_AMOUNT)
            }
        })
    })

    describe('zaps into Token strategy', () => {
        let amountPerInvestmentMinusFees: bigint

        beforeEach(async () => {
            await strategyManager.connect(account0).createStrategy({
                dcaInvestments: [],
                vaultInvestments: [],
                liquidityInvestments: [],
                buyInvestments: [
                    {
                        token: wbtc,
                        percentage: 50n,
                    },
                    {
                        token: weth,
                        percentage: 50n,
                    },
                ],
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

            await stablecoin.connect(account0).mint(account0, amount)
            await stablecoin.connect(account0).approve(strategyManager, amount)

            amountPerInvestmentMinusFees = await deductStrategyFee(amount * 50n / 100n)
        })

        it('zaps with 1% slippage', async () => {
            await strategyManager
                .connect(account0)
                .invest({
                    strategyId,
                    inputToken: stablecoin,
                    inputAmount: amount,
                    inputTokenSwap: '0x',
                    dcaSwaps: [],
                    vaultSwaps: [],
                    buySwaps: [
                        await UniswapV2ZapHelper.encodeSwap(
                            amountPerInvestmentMinusFees,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                            strategyManager,
                        ),
                        await UniswapV2ZapHelper.encodeSwap(
                            amountPerInvestmentMinusFees,
                            stablecoin,
                            weth,
                            USD_PRICE_BN,
                            ETH_PRICE_BN,
                            new BigNumber(0.01),
                            strategyManager,
                        ),
                    ],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            const expectedAmountBTC = BigInt(
                new BigNumber(amountPerInvestmentMinusFees.toString())
                    .div(BTC_PRICE_BN)
                    .toFixed(0),
            )
            const expectedAmountETH = BigInt(
                new BigNumber(amountPerInvestmentMinusFees.toString())
                    .div(ETH_PRICE_BN)
                    .toFixed(0),
            )

            Compare.almostEqualPercentage({
                target: expectedAmountBTC,
                value: await wbtc.balanceOf(strategyManager),
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })

            Compare.almostEqualPercentage({
                target: expectedAmountETH,
                value: await weth.balanceOf(strategyManager),
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })

            await strategyManager.connect(account0).closePosition(0, [])

            Compare.almostEqualPercentage({
                target: expectedAmountBTC,
                value: await wbtc.balanceOf(account0),
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })

            Compare.almostEqualPercentage({
                target: expectedAmountETH,
                value: await weth.balanceOf(account0),
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })
        })

        it('fails with 0% slippage', async () => {
            try {
                await strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amount,
                        inputTokenSwap: '0x',
                        dcaSwaps: [],
                        vaultSwaps: [],
                        buySwaps: [
                            await UniswapV2ZapHelper.encodeSwap(
                                amountPerInvestmentMinusFees,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                                strategyManager,
                            ),
                            await UniswapV2ZapHelper.encodeSwap(
                                amountPerInvestmentMinusFees,
                                stablecoin,
                                weth,
                                USD_PRICE_BN,
                                ETH_PRICE_BN,
                                new BigNumber(0),
                                strategyManager,
                            ),
                        ],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    })

                throw new Error('Expected to fail')
            }
            catch (e) {
                const error = decodeLowLevelCallError(e)

                expect(error).to.equal(INSUFFICIENT_OUTPUT_AMOUNT)
            }
        })
    })

    describe('zaps into mixed strategy with vaults and dca', () => {
        let initialLpBalance: bigint
        let initialStablecoinBalance: bigint
        let amountPerInvestmentMinusFees: bigint

        beforeEach(async () => {
            initialLpBalance = await btcEthLpUniV2.balanceOf(account0)
            initialStablecoinBalance = await stablecoin.balanceOf(account0)

            await strategyManager.connect(account0).createStrategy({
                dcaInvestments: [
                    {
                        poolId: stableBtcPoolId,
                        swaps: 10,
                        percentage: 25n,
                    },
                    {
                        poolId: btcEthPoolId,
                        swaps: 10,
                        percentage: 25n,
                    },
                ],
                vaultInvestments: [
                    {
                        vault: await createVault(wbtc),
                        percentage: 25n,
                    },
                    {
                        vault: await createVault(await factoryUniV2.getPair(wbtc, weth)),
                        percentage: 25n,
                    },
                ],
                liquidityInvestments: [],
                buyInvestments: [],
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

            await stablecoin.connect(account0).mint(account0, amount)
            await stablecoin.connect(account0).approve(strategyManager, amount)

            amountPerInvestmentMinusFees = await deductStrategyFee(amount * 25n / 100n)
        })

        it('zaps with 1% slippage', async () => {
            await strategyManager
                .connect(account0)
                .invest({
                    strategyId,
                    inputToken: stablecoin,
                    inputAmount: amount,
                    inputTokenSwap: '0x',
                    dcaSwaps: [
                        '0x',
                        await UniswapV2ZapHelper.encodeSwap(
                            amountPerInvestmentMinusFees,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                            strategyManager,
                        ),
                    ],
                    vaultSwaps: [
                        await UniswapV2ZapHelper.encodeSwap(
                            amountPerInvestmentMinusFees,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                            strategyManager,
                        ),
                        await UniswapV2ZapHelper.encodeZap(
                            amountPerInvestmentMinusFees,
                            stablecoin,
                            wbtc,
                            weth,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            ETH_PRICE_BN,
                            new BigNumber(0.01),
                            zapManager,
                            factoryUniV2,
                        ),
                    ],
                    buySwaps: [],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await strategyManager.connect(account0).closePosition(0, [])

            Compare.almostEqualPercentage({
                target: amount * 25n / 100n,
                value: (await stablecoin.balanceOf(account0)) - initialStablecoinBalance,
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })

            Compare.almostEqualPercentage({
                target: amount * 50n / 100n / BTC_PRICE, // 25% from DCA and 25% from vault
                value: await wbtc.balanceOf(account0),
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })

            const amountPerToken = amount * 25n / 100n / 2n
            const amountA = amountPerToken / BTC_PRICE
            const amountB = amountPerToken / ETH_PRICE

            Compare.almostEqualPercentage({
                target: await UniswapV2.estimateLiquidityOutput(amountA, amountB),
                value: await btcEthLpUniV2.balanceOf(account0) - initialLpBalance,
                tolerance: new BigNumber(0.01), // Tolerance of 1%
            })
        })

        it('fails with 0% slippage', async () => {
            try {
                await strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amount,
                        inputTokenSwap: '0x',
                        dcaSwaps: [
                            '0x',
                            await UniswapV2ZapHelper.encodeSwap(
                                amountPerInvestmentMinusFees,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                                strategyManager,
                            ),
                        ],
                        vaultSwaps: [
                            await UniswapV2ZapHelper.encodeSwap(
                                amountPerInvestmentMinusFees,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                                strategyManager,
                            ),
                            await UniswapV2ZapHelper.encodeZap(
                                amountPerInvestmentMinusFees,
                                stablecoin,
                                wbtc,
                                weth,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                ETH_PRICE_BN,
                                new BigNumber(0),
                                zapManager,
                                factoryUniV2,
                            ),
                        ],
                        buySwaps: [],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    })

                throw new Error('Expected to fail')
            }
            catch (e) {
                const error = decodeLowLevelCallError(e)

                expect(error).to.equal(INSUFFICIENT_OUTPUT_AMOUNT)
            }
        })

        it('zaps input token with 1% slippage using uni v2', async () => {
            await wbtc.mint(account0, amount / BTC_PRICE)
            await wbtc.approve(strategyManager, amount / BTC_PRICE)

            const slippage = new BigNumber(0.01)
            const amountPerInvestmentBn = new BigNumber(amountPerInvestmentMinusFees.toString())
            const amountPerInvestmentMinusSlippage = BigInt(
                amountPerInvestmentBn
                    .minus(amountPerInvestmentBn.times(slippage))
                    .toFixed(0),
            )
            const initialBalanceStable = await stablecoin.balanceOf(account0)

            await strategyManager
                .connect(account0)
                .invest({
                    strategyId,
                    inputToken: wbtc,
                    inputAmount: amount / BTC_PRICE,
                    inputTokenSwap: await UniswapV2ZapHelper.encodeSwap(
                        amount / BTC_PRICE,
                        wbtc,
                        stablecoin,
                        BTC_PRICE_BN,
                        USD_PRICE_BN,
                        slippage,
                        strategyManager,
                    ),
                    dcaSwaps: [
                        '0x',
                        await UniswapV2ZapHelper.encodeSwap(
                            amountPerInvestmentMinusSlippage,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            slippage,
                            strategyManager,
                        ),
                    ],
                    vaultSwaps: [
                        await UniswapV2ZapHelper.encodeSwap(
                            amountPerInvestmentMinusSlippage,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            slippage,
                            strategyManager,
                        ),
                        await UniswapV2ZapHelper.encodeZap(
                            amountPerInvestmentMinusSlippage,
                            stablecoin,
                            wbtc,
                            weth,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            ETH_PRICE_BN,
                            slippage,
                            zapManager,
                            factoryUniV2,
                        ),
                    ],
                    buySwaps: [],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await strategyManager.connect(account0).closePosition(0, [])

            // 1/4 investments have stable as input token
            Compare.almostEqualPercentage({
                target: initialBalanceStable + amountPerInvestmentMinusFees,
                value: await stablecoin.balanceOf(account0),
                tolerance: slippage,
            })

            // 2/4 investments have wbtc as input token
            Compare.almostEqualPercentage({
                target: amount / BTC_PRICE / 2n,
                value: await wbtc.balanceOf(account0),
                tolerance: slippage.times(2), // 2x slippage because of multiple swaps
            })

            // 1/4 investments have btc-eth LP as input token
            Compare.almostEqualPercentage({
                target: await UniswapV2.estimateLiquidityOutput(
                    amountPerInvestmentMinusFees / 2n / BTC_PRICE,
                    amountPerInvestmentMinusFees / 2n / ETH_PRICE,
                ),
                value: await btcEthLpUniV2.balanceOf(account0) - initialLpBalance,
                tolerance: slippage.times(2), // 2x slippage because of multiple swaps
            })
        })
    })

    describe('Invest in buy product', () => {
        let strategyId: bigint
        const amount = parseEther('10')

        beforeEach(async () => {
            strategyId = await strategyManager.getStrategiesLength()

            await strategyManager.connect(account0).createStrategy({
                dcaInvestments: [],
                vaultInvestments: [],
                liquidityInvestments: [],
                buyInvestments: [
                    {
                        token: stablecoin,
                        percentage: 50n,
                    },
                    {
                        token: wbtc,
                        percentage: 50n,
                    },
                ],
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

            await stablecoin.connect(account0).mint(account0, amount)
            await stablecoin.connect(account0).approve(strategyManager, amount)
        })

        it('invests in buy when input token is the same as output token', async  () => {
            await strategyManager.connect(account0).invest({
                strategyId,
                inputToken: stablecoin,
                inputAmount: amount,
                inputTokenSwap: '0x',
                dcaSwaps: [],
                vaultSwaps: [],
                liquidityZaps: [],
                buySwaps: [
                    '0x',
                    await UniswapV3ZapHelper.encodeExactInput(
                        await Fees.deductStrategyFee(
                            amount / 2n,
                            strategyManager,
                            strategyId,
                            true,
                            true,
                            dca,
                            vaultManager,
                            liquidityManager,
                            buyProduct,
                        ),
                        new PathUniswapV3(
                            stablecoin,
                            [{ token: wbtc, fee: 3000 }],
                        ),
                        USD_PRICE_BN,
                        BTC_PRICE_BN,
                        new BigNumber(0.05),
                        strategyManager,
                    ),
                ],
                investorPermit: permitAccount0,
                strategistPermit: permitAccount0,
            })

            const { buyPositions } = await strategyManager.getPositionInvestments(account0, 0)

            expect(buyPositions[0].token).to.equal(stablecoin)
            expect(buyPositions[1].token).to.equal(wbtc)

            Compare.almostEqualPercentage({
                value: buyPositions[0].amount,
                target: amount / 2n,
                tolerance: new BigNumber(0.01),
            })

            Compare.almostEqualPercentage({
                value: BigInt(BTC_PRICE_BN.times(buyPositions[1].amount.toString()).toFixed(0)),
                target: amount / 2n,
                tolerance: new BigNumber(0.01),
            })
        })
    })
})
