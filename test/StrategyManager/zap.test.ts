import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    BeefyMockStrategy__factory,
    BeefyVaultV7__factory,
    DollarCostAverage,
    BuyProduct,
    LiquidityManager,
    StrategyManager__v2,
    SubscriptionManager,
    TestERC20,
    VaultManager,
    UniversalRouter,
} from '@src/typechain'
import { expect } from 'chai'
import { AddressLike, parseEther, Signer, ZeroHash } from 'ethers'
import hre from 'hardhat'
import { PathUniswapV3, TokenQuote, Fees } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { Compare } from '@src/Compare'
import { zapFixture } from './fixtures/zap.fixture'
import { expectCustomError, SwapEncoder } from '@src/helpers'
import {
    BTC_PRICE,
    BTC_PRICE_BN,
    BTC_QUOTE,
    ETH_PRICE,
    ETH_PRICE_BN,
    ETH_QUOTE,
    USD_QUOTE,
    ONE_PERCENT,
} from '@src/constants'

describe('StrategyManager#invest (zap)', () => {
    const amount = parseEther('1000')

    // accounts
    let account0: Signer
    let treasury: Signer

    // tokens
    let stablecoin: TestERC20
    let weth: TestERC20
    let wbtc: TestERC20

    // hub contracts
    let strategyManager: StrategyManager__v2
    let dca: DollarCostAverage
    let vaultManager: VaultManager
    let liquidityManager: LiquidityManager
    let buyProduct: BuyProduct

    // external test contracts
    let universalRouter: UniversalRouter

    // global data
    let strategyId: bigint
    let stableBtcPoolId: bigint
    let btcEthPoolId: bigint
    let initialTreasuryBalance: bigint
    let permitAccount0: SubscriptionManager.PermitStruct

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

    function encodeSwapV2(
        amount: bigint,
        path: AddressLike[],
        inputQuote: TokenQuote,
        outputQuote: TokenQuote,
        slippage: BigNumber,
    ) {
        return SwapEncoder.encodeExactInputV2(
            universalRouter,
            amount,
            path,
            inputQuote,
            outputQuote,
            slippage,
            strategyManager,
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

            // external test contracts
            universalRouter,

            // global data
            strategyId,
            stableBtcPoolId,
            btcEthPoolId,
            initialTreasuryBalance,
            permitAccount0,
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
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, wbtc],
                            USD_QUOTE,
                            BTC_QUOTE,
                            ONE_PERCENT,
                        ),
                    ],
                    vaultSwaps: [],
                    buySwaps: [],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await validateDcaZap(ONE_PERCENT)
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
                        await SwapEncoder.encodeExactInputV3(
                            universalRouter,
                            amountPerInvestmentMinusFees,
                            await PathUniswapV3.fromAddressLike(
                                stablecoin,
                                [{ token: wbtc, fee: 3000 }],
                            ),
                            USD_QUOTE,
                            BTC_QUOTE,
                            ONE_PERCENT,
                            strategyManager,
                        ),
                    ],
                    vaultSwaps: [],
                    buySwaps: [],
                    liquidityZaps: [],
                    investorPermit: permitAccount0,
                    strategistPermit: permitAccount0,
                })

            await validateDcaZap(ONE_PERCENT)
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
                        await SwapEncoder.encodeExactInputV3(
                            universalRouter,
                            amountPerInvestmentMinusFees,
                            await PathUniswapV3.fromAddressLike(
                                stablecoin,
                                [
                                    { token: weth, fee: 3000 },
                                    { token: wbtc, fee: 3000 },
                                ],
                            ),
                            USD_QUOTE,
                            BTC_QUOTE,
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

            await expectCustomError(
                strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amount,
                        inputTokenSwap: '0x',
                        dcaSwaps: [
                            '0x',
                            await SwapEncoder.encodeExactInputV3(
                                universalRouter,
                                amountPerInvestmentMinusFees,
                                await PathUniswapV3.fromAddressLike(
                                    stablecoin,
                                    [{ token: wbtc, fee: 3000 }],
                                ),
                                USD_QUOTE,
                                BTC_QUOTE,
                                new BigNumber(0),
                                strategyManager,
                            ),
                        ],
                        vaultSwaps: [],
                        buySwaps: [],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    }),
                'V3TooLittleReceived',
            )
        })
    })

    describe('zaps into Vault strategy', () => {
        let amountPerInvestmentMinusFees: bigint

        beforeEach(async () => {
            await strategyManager.connect(account0).createStrategy({
                dcaInvestments: [],
                vaultInvestments: [
                    {
                        vault: await createVault(wbtc),
                        percentage: 50n,
                    },
                    {
                        vault: await createVault(weth),
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
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, wbtc],
                            USD_QUOTE,
                            BTC_QUOTE,
                            ONE_PERCENT,
                        ),
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, weth],
                            USD_QUOTE,
                            ETH_QUOTE,
                            ONE_PERCENT,
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
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })

            Compare.almostEqualPercentage({
                target: amount * 50n / 100n / ETH_PRICE,
                value: await weth.balanceOf(account0),
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })
        })

        it('fails with 0% slippage', async () => {
            await expectCustomError(
                strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amount,
                        inputTokenSwap: '0x',
                        dcaSwaps: [],
                        vaultSwaps: [
                            await encodeSwapV2(
                                amountPerInvestmentMinusFees,
                                [stablecoin, wbtc],
                                USD_QUOTE,
                                BTC_QUOTE,
                                new BigNumber(0),
                            ),
                            '0x', // no need for this swap since the first will fail making the transaction revert
                        ],
                        buySwaps: [],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    }),
                'V2TooLittleReceived',
            )
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
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, wbtc],
                            USD_QUOTE,
                            BTC_QUOTE,
                            ONE_PERCENT,
                        ),
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, weth],
                            USD_QUOTE,
                            ETH_QUOTE,
                            ONE_PERCENT,
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
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })

            Compare.almostEqualPercentage({
                target: expectedAmountETH,
                value: await weth.balanceOf(strategyManager),
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })

            await strategyManager.connect(account0).closePosition(0, [])

            Compare.almostEqualPercentage({
                target: expectedAmountBTC,
                value: await wbtc.balanceOf(account0),
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })

            Compare.almostEqualPercentage({
                target: expectedAmountETH,
                value: await weth.balanceOf(account0),
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })
        })

        it('fails with 0% slippage', async () => {
            await expectCustomError(
                strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amount,
                        inputTokenSwap: '0x',
                        dcaSwaps: [],
                        vaultSwaps: [],
                        buySwaps: [
                            await encodeSwapV2(
                                amountPerInvestmentMinusFees,
                                [stablecoin, wbtc],
                                USD_QUOTE,
                                BTC_QUOTE,
                                new BigNumber(0),
                            ),
                            await encodeSwapV2(
                                amountPerInvestmentMinusFees,
                                [stablecoin, weth],
                                USD_QUOTE,
                                ETH_QUOTE,
                                new BigNumber(0),
                            ),
                        ],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    }),
                'V2TooLittleReceived',
            )
        })
    })

    describe('zaps into mixed strategy with vaults and dca', () => {
        let initialStablecoinBalance: bigint
        let amountPerInvestmentMinusFees: bigint

        beforeEach(async () => {
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
                        vault: await createVault(weth),
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
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, wbtc],
                            USD_QUOTE,
                            BTC_QUOTE,
                            ONE_PERCENT,
                        ),
                    ],
                    vaultSwaps: [
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, wbtc],
                            USD_QUOTE,
                            BTC_QUOTE,
                            ONE_PERCENT,
                        ),
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, weth],
                            USD_QUOTE,
                            ETH_QUOTE,
                            ONE_PERCENT,
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
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })

            Compare.almostEqualPercentage({
                target: amount * 50n / 100n / BTC_PRICE, // 25% from DCA and 25% from vault
                value: await wbtc.balanceOf(account0),
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })

            Compare.almostEqualPercentage({
                target: amount * 25n / 100n / ETH_PRICE, // 25% from vault
                value: await weth.balanceOf(account0),
                tolerance: ONE_PERCENT, // Tolerance of 1%
            })
        })

        it('fails with 0% slippage', async () => {
            await expectCustomError(
                strategyManager
                    .connect(account0)
                    .invest({
                        strategyId,
                        inputToken: stablecoin,
                        inputAmount: amount,
                        inputTokenSwap: '0x',
                        dcaSwaps: [
                            '0x',
                            await encodeSwapV2(
                                amountPerInvestmentMinusFees,
                                [stablecoin, wbtc],
                                USD_QUOTE,
                                BTC_QUOTE,
                                new BigNumber(0),
                            ),
                        ],
                        vaultSwaps: [
                            await encodeSwapV2(
                                amountPerInvestmentMinusFees,
                                [stablecoin, wbtc],
                                USD_QUOTE,
                                BTC_QUOTE,
                                new BigNumber(0),
                            ),
                            '0x', // no need for this swap since the first will fail making the transaction revert
                        ],
                        buySwaps: [],
                        liquidityZaps: [],
                        investorPermit: permitAccount0,
                        strategistPermit: permitAccount0,
                    }),
                'V2TooLittleReceived',
            )
        })

        it('zaps input token with 1% slippage using uni v2', async () => {
            await wbtc.mint(account0, amount / BTC_PRICE)
            await wbtc.approve(strategyManager, amount / BTC_PRICE)

            const slippage = ONE_PERCENT
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
                    inputTokenSwap: await encodeSwapV2(
                        amount / BTC_PRICE,
                        [wbtc, stablecoin],
                        USD_QUOTE,
                        BTC_QUOTE,
                        slippage,
                    ),
                    dcaSwaps: [
                        '0x',
                        await encodeSwapV2(
                            amountPerInvestmentMinusSlippage,
                            [stablecoin, wbtc],
                            USD_QUOTE,
                            BTC_QUOTE,
                            slippage,
                        ),
                    ],
                    vaultSwaps: [
                        await encodeSwapV2(
                            amountPerInvestmentMinusSlippage,
                            [stablecoin, wbtc],
                            USD_QUOTE,
                            BTC_QUOTE,
                            slippage,
                        ),
                        await encodeSwapV2(
                            amountPerInvestmentMinusFees,
                            [stablecoin, weth],
                            USD_QUOTE,
                            ETH_QUOTE,
                            ONE_PERCENT,
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

            // 1/4 investments have weth as input token
            Compare.almostEqualPercentage({
                target: amount * 25n / 100n / ETH_PRICE,
                value: await weth.balanceOf(account0),
                tolerance: ONE_PERCENT, // Tolerance of 1%
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

        it('invests in buy when input token is the same as output token', async () => {
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
                    await SwapEncoder.encodeExactInputV3(
                        universalRouter,
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
                        await PathUniswapV3.fromAddressLike(
                            stablecoin,
                            [{ token: wbtc, fee: 3000 }],
                        ),
                        USD_QUOTE,
                        BTC_QUOTE,
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
                tolerance: ONE_PERCENT,
            })

            Compare.almostEqualPercentage({
                value: BigInt(BTC_PRICE_BN.times(buyPositions[1].amount.toString()).toFixed(0)),
                target: amount / 2n,
                tolerance: ONE_PERCENT,
            })
        })
    })
})
