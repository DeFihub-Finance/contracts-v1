import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    UniswapV2,
    BaseZapHelper,
    UniswapV2ZapHelper,
    UniswapV3ZapHelper,
} from '@src/helpers'
import {
    BeefyMockStrategy__factory,
    BeefyVaultV7__factory,
    DollarCostAverage,
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
import { ErrorDecoder } from '@src/helpers/ErrorDecoder'

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

    // helpers
    let uniswapV2ZapHelper: UniswapV2ZapHelper
    let uniswapV3ZapHelper: UniswapV3ZapHelper

    async function createVault(token: AddressLike) {
        const [deployer] = await hre.ethers.getSigners()
        const strategy = await new BeefyMockStrategy__factory(deployer).deploy()
        const vault = await new BeefyVaultV7__factory(deployer).deploy()

        await vault.initialize(strategy, 'Mock Vault', 'mooMV', 0)
        await strategy.initialize(vault, token)

        await vaultManager.setVaultWhitelistStatus(vault, true)

        return vault
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

            // helpers
            uniswapV2ZapHelper,
            uniswapV3ZapHelper,

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
            await strategyManager.connect(account0).closePosition(0)

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

            const { protocolFee, strategistFee } = await strategyManager.calculateFee(
                strategyId,
                dca,
                amount,
                account0,
                account0,
                permitAccount0,
                permitAccount0,
            )

            expect(await stablecoin.balanceOf(treasury)).to.equal(initialTreasuryBalance + protocolFee)
            expect(await stablecoin.balanceOf(zapManager)).to.equal(0)
            expect(await stablecoin.balanceOf(dca)).to.equal(0)
            expect(await stablecoin.balanceOf(strategyManager)).to.equal(strategistFee)
        }

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
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

            await stablecoin.connect(account0).mint(account0, amount)
            await stablecoin.connect(account0).approve(strategyManager, amount)
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
                        await uniswapV2ZapHelper.encodeSwap(
                            strategyId,
                            dca,
                            amount * 50n / 100n,
                            account0,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                        ),
                    ],
                    vaultSwaps: [],
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
                        await uniswapV3ZapHelper.encodeExactInputSingle(
                            strategyId,
                            dca,
                            amount * 50n / 100n,
                            account0,
                            stablecoin,
                            wbtc,
                            3000,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                            strategyManager,
                        ),
                    ],
                    vaultSwaps: [],
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
                        await uniswapV3ZapHelper.encodeExactInput(
                            strategyId,
                            dca,
                            amount * 50n / 100n,
                            zapManager,
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
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await validateDcaZap(new BigNumber(0.015)) // 1.5% because of multi-hop
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
                            await uniswapV2ZapHelper.encodeSwap(
                                strategyId,
                                dca,
                                amount * 50n / 100n,
                                account0,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                            ),
                        ],
                        vaultSwaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    })

                throw new Error('Expected to fail')
            }
            catch (e) {
                const error = ErrorDecoder.decodeLowLevelCallError(e)

                expect(error).to.equal(INSUFFICIENT_OUTPUT_AMOUNT)
            }
        })
    })

    describe('zaps into Vault strategy', () => {
        let initialLpBalance: bigint

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
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

            await stablecoin.connect(account0).mint(account0, amount)
            await stablecoin.connect(account0).approve(strategyManager, amount)
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
                        await uniswapV2ZapHelper.encodeSwap(
                            strategyId,
                            vaultManager,
                            amount * 50n / 100n,
                            account0,
                            stablecoin,
                            wbtc,

                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                        ),
                        await uniswapV2ZapHelper.encodeZap(
                            strategyId,
                            vaultManager,
                            amount * 50n / 100n,
                            account0,
                            stablecoin,
                            wbtc,
                            weth,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            ETH_PRICE_BN,
                            new BigNumber(0.01),
                            factoryUniV2,
                        ),
                    ],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await strategyManager.connect(account0).closePosition(0)

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
                            await uniswapV2ZapHelper.encodeSwap(
                                strategyId,
                                vaultManager,
                                amount * 50n / 100n,
                                account0,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                            ),
                            await uniswapV2ZapHelper.encodeZap(
                                strategyId,
                                vaultManager,
                                amount * 50n / 100n,
                                account0,
                                stablecoin,
                                wbtc,
                                weth,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                ETH_PRICE_BN,
                                new BigNumber(0),
                                factoryUniV2,
                            ),
                        ],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    })

                throw new Error('Expected to fail')
            }
            catch (e) {
                const error = ErrorDecoder.decodeLowLevelCallError(e)

                expect(error).to.equal(INSUFFICIENT_OUTPUT_AMOUNT)
            }
        })
    })

    describe('zaps into mixed strategy with vaults and dca', () => {
        let initialLpBalance: bigint
        let initialStablecoinBalance: bigint

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
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

            await stablecoin.connect(account0).mint(account0, amount)
            await stablecoin.connect(account0).approve(strategyManager, amount)
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
                        await uniswapV2ZapHelper.encodeSwap(
                            strategyId,
                            dca,
                            amount * 25n / 100n,
                            account0,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                        ),
                    ],
                    vaultSwaps: [
                        await uniswapV2ZapHelper.encodeSwap(
                            strategyId,
                            vaultManager,
                            amount * 25n / 100n,
                            account0,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            new BigNumber(0.01),
                        ),
                        await uniswapV2ZapHelper.encodeZap(
                            strategyId,
                            vaultManager,
                            amount * 25n / 100n,
                            account0,
                            stablecoin,
                            wbtc,
                            weth,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            ETH_PRICE_BN,
                            new BigNumber(0.01),
                            factoryUniV2,
                        ),
                    ],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await strategyManager.connect(account0).closePosition(0)

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
                            await uniswapV2ZapHelper.encodeSwap(
                                strategyId,
                                dca,
                                amount * 25n / 100n,
                                account0,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                            ),
                        ],
                        vaultSwaps: [
                            await uniswapV2ZapHelper.encodeSwap(
                                strategyId,
                                vaultManager,
                                amount * 25n / 100n,
                                account0,
                                stablecoin,
                                wbtc,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                new BigNumber(0),
                            ),
                            await uniswapV2ZapHelper.encodeZap(
                                strategyId,
                                vaultManager,
                                amount * 25n / 100n,
                                account0,
                                stablecoin,
                                wbtc,
                                weth,
                                USD_PRICE_BN,
                                BTC_PRICE_BN,
                                ETH_PRICE_BN,
                                new BigNumber(0),
                                factoryUniV2,
                            ),
                        ],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    })

                throw new Error('Expected to fail')
            }
            catch (e) {
                const error = ErrorDecoder.decodeLowLevelCallError(e)

                expect(error).to.equal(INSUFFICIENT_OUTPUT_AMOUNT)
            }
        })

        it('zaps input token with 1% slippage using uni v2', async () => {
            await wbtc.mint(account0, amount / BTC_PRICE)
            await wbtc.approve(strategyManager, amount / BTC_PRICE)

            const slippage = new BigNumber(0.01)
            const amountPerInvestment = amount * 25n / 100n
            const amountPerInvestmentBn = new BigNumber(amountPerInvestment.toString())
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
                    inputTokenSwap: await uniswapV2ZapHelper.encodeSwap(
                        strategyId,
                        dca,
                        amount / BTC_PRICE,
                        account0,
                        wbtc,
                        stablecoin,
                        BTC_PRICE_BN,
                        USD_PRICE_BN,
                        slippage,
                    ),
                    dcaSwaps: [
                        '0x',
                        await uniswapV2ZapHelper.encodeSwap(
                            strategyId,
                            dca,
                            amountPerInvestmentMinusSlippage,
                            account0,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            slippage,
                        ),
                    ],
                    vaultSwaps: [
                        await uniswapV2ZapHelper.encodeSwap(
                            strategyId,
                            vaultManager,
                            amountPerInvestmentMinusSlippage,
                            account0,
                            stablecoin,
                            wbtc,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            slippage,
                        ),
                        await uniswapV2ZapHelper.encodeZap(
                            strategyId,
                            vaultManager,
                            amountPerInvestmentMinusSlippage,
                            account0,
                            stablecoin,
                            wbtc,
                            weth,
                            USD_PRICE_BN,
                            BTC_PRICE_BN,
                            ETH_PRICE_BN,
                            slippage,
                            factoryUniV2,
                        ),
                    ],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await strategyManager.connect(account0).closePosition(0)

            // 1/4 investments have stable as input token
            Compare.almostEqualPercentage({
                target: initialBalanceStable + amountPerInvestment,
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
                    amountPerInvestment / 2n / BTC_PRICE,
                    amountPerInvestment / 2n / ETH_PRICE,
                ),
                value: await btcEthLpUniV2.balanceOf(account0) - initialLpBalance,
                tolerance: slippage.times(2), // 2x slippage because of multiple swaps
            })
        })
    })
})
