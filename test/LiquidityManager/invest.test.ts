import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { Fees, Slippage, unwrapAddressLike } from '@defihub/shared'
import { LiquidityManagerFixture } from './liquidity-manager.fixture'
import {
    LiquidityManager,
    NonFungiblePositionManager,
    SubscriptionManager,
    TestERC20,
    UniswapV3Pool,
} from '@src/typechain'
import { UniswapV2ZapHelper, UniswapV3ZapHelper } from '@src/helpers'
import { AddressLike, ErrorDescription, Signer, ZeroAddress, parseEther } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { ErrorDecoder } from '@src/helpers/ErrorDecoder'

describe.only('LiquidityManager#invest', () => {
    const amount = parseEther('1000')
    const SLIPPAGE_BN = new BigNumber(0.01)

    // prices
    let USD_PRICE_BN: BigNumber
    let BTC_PRICE_BN: BigNumber
    let ETH_PRICE_BN: BigNumber

    // accounts
    let account0: Signer

    // tokens
    let stablecoin: TestERC20
    let weth: TestERC20
    let wbtc: TestERC20

    // hub contracts
    let liquidityManager: LiquidityManager

    // external test contracts
    let positionManagerUniV3: NonFungiblePositionManager
    let stableBtcLpUniV3: UniswapV3Pool
    let btcEthLpUniV3: UniswapV3Pool

    // global data
    let permitAccount0: SubscriptionManager.PermitStruct

    // helpers
    let uniswapV2ZapHelper: UniswapV2ZapHelper
    let uniswapV3ZapHelper: UniswapV3ZapHelper

    // TODO use helper from shared
    function getNearestUsableTick(tick: bigint, tickSpacing: bigint) {
        return (tick / tickSpacing) * tickSpacing
    }

    async function deductFees(amount: bigint) {
        return Fees.deductProductFee(
            liquidityManager,
            amount,
            account0,
            permitAccount0,
            hre.ethers.provider,
        )
    }

    async function sortTokens(tokenA: TestERC20, tokenB: TestERC20) {
        const [addressTokenA, addressTokenB] = await Promise.all([
            unwrapAddressLike(tokenA),
            unwrapAddressLike(tokenB),
        ])

        return addressTokenA.toLowerCase() > addressTokenB.toLowerCase()
            ? { token0: tokenB, token1: tokenA }
            : { token0: tokenA, token1: tokenB }
    }

    async function isSameToken(tokenA: AddressLike, tokenB: AddressLike) {
        const [addressTokenA, addressTokenB] = await Promise.all([
            unwrapAddressLike(tokenA),
            unwrapAddressLike(tokenB),
        ])

        return addressTokenA.toLowerCase() === addressTokenB.toLowerCase()
    }

    function getEncodedSwap(
        amount: bigint,
        outputToken: AddressLike,
        outputTokenPrice: BigNumber,
        protocol: 'uniswapV2' | 'uniswapV3' = 'uniswapV2',
    ) {
        return protocol === 'uniswapV2'
            ? uniswapV2ZapHelper.encodeSwap(
                amount,
                stablecoin,
                outputToken,
                USD_PRICE_BN,
                outputTokenPrice,
                SLIPPAGE_BN,
                liquidityManager,
            )
            : uniswapV3ZapHelper.encodeExactInputSingle(
                amount,
                stablecoin,
                outputToken,
                3000,
                USD_PRICE_BN,
                outputTokenPrice,
                SLIPPAGE_BN,
                liquidityManager,
            )
    }

    function getMinOutput(amount: bigint, tokenPrice: BigNumber) {
        // Assume its stablecoin
        if (tokenPrice.eq(USD_PRICE_BN))
            return Slippage.deductSlippage(amount, SLIPPAGE_BN)

        const amountBn = new BigNumber(amount.toString())

        return Slippage.deductSlippage(
            BigInt(amountBn.div(tokenPrice).toFixed(0)),
            SLIPPAGE_BN.times(2),
        )
    }

    beforeEach(async () => {
        ({
            // prices
            USD_PRICE_BN,
            BTC_PRICE_BN,
            ETH_PRICE_BN,

            // accounts
            account0,

            // tokens
            weth,
            wbtc,
            stablecoin,

            // hub contracts
            liquidityManager,

            // global data
            permitAccount0,

            // external test contracts
            positionManagerUniV3,
            stableBtcLpUniV3,
            btcEthLpUniV3,

            // helpers
            uniswapV2ZapHelper,
            uniswapV3ZapHelper,
        } = await loadFixture(LiquidityManagerFixture))
    })

    it('should add liquidity using 50/50 token0 and token1 amount proportion', async () => {
        await stablecoin.connect(account0).mint(account0, amount)
        await stablecoin.connect(account0).approve(liquidityManager, amount)

        const halfAmount = amount * 50n / 100n
        const halfAmountWithDeductedFees = await deductFees(halfAmount)

        const [
            { tick },
            tickSpacing,
            { token0 },
            encodedSwap,
        ] = await Promise.all([
            stableBtcLpUniV3.slot0(),
            stableBtcLpUniV3.tickSpacing(),
            sortTokens(stablecoin, wbtc),
            getEncodedSwap(halfAmountWithDeductedFees, wbtc, BTC_PRICE_BN),
        ])

        const stableIsToken0 = await isSameToken(stablecoin, token0)

        const stableAmountMin = getMinOutput(halfAmountWithDeductedFees, USD_PRICE_BN)
        const wbtcAmountMin = getMinOutput(halfAmountWithDeductedFees, BTC_PRICE_BN)

        await liquidityManager
            .connect(account0)
            .addLiquidityV3(
                {
                    positionManager: positionManagerUniV3,
                    inputToken: stablecoin,
                    depositAmountInputToken: amount,

                    fee: 3_000,

                    token0: stableIsToken0 ? stablecoin : wbtc,
                    token1: stableIsToken0 ? wbtc : stablecoin,

                    swapToken0: stableIsToken0 ? '0x' : encodedSwap,
                    swapToken1: stableIsToken0 ? encodedSwap : '0x',

                    swapAmountToken0: halfAmountWithDeductedFees,
                    swapAmountToken1: halfAmountWithDeductedFees,

                    // TODO calculate tick dinamically using price
                    tickLower: getNearestUsableTick(tick - (tick / 10n), tickSpacing),
                    tickUpper: getNearestUsableTick(tick + (tick / 10n), tickSpacing),

                    amount0Min: stableIsToken0 ? stableAmountMin : wbtcAmountMin,
                    amount1Min: stableIsToken0 ? wbtcAmountMin : stableAmountMin,
                },
                permitAccount0,
            )
    })
            .connect(account0)
            .createStrategy({
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
                permit: permitAccount0,
                metadataHash: ZeroHash,
            })

        // TODO test with v3 encode swap in the same tx
        // TODO refactor to use encode without strategyId after migrating error decoder and zapper helpers
        const encodedSwap = await uniswapV2ZapHelper.encodeSwap(
            strategyId,
            liquidityManager,
            halfAmount,
            account0,
            stablecoin,
            wbtc,
            USD_PRICE_BN,
            BTC_PRICE_BN,
            SLIPPAGE_BN,
            liquidityManager,
        )

        await stablecoin.connect(account0).mint(account0, amount)
        await stablecoin.connect(account0).approve(liquidityManager, amount)

        const initialPosition = await positionManagerUniV3.positions(1n)
        const stableIsToken0 = await stablecoin.getAddress() === initialPosition.token0
        const halfAmountWithDeductedFees = halfAmount - parseEther('1.5')

        try {
            await liquidityManager
                .connect(account0)
                .addLiquidityV3(
                    {
                        positionManager: positionManagerUniV3,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: initialPosition.fee,

                        // TODO not use token addresses from position
                        token0: initialPosition.token0,
                        token1: initialPosition.token1,

                        swapToken0: stableIsToken0 ? '0x' : encodedSwap,
                        swapToken1: stableIsToken0 ? encodedSwap : '0x',

                        // TODO test with different proportions
                        swapAmountToken0: halfAmountWithDeductedFees,
                        swapAmountToken1: halfAmountWithDeductedFees,

                        // TODO calculate tick dinamically using price
                        tickLower: initialPosition.tickLower,
                        tickUpper: initialPosition.tickUpper,

                        amount0Min: stableIsToken0
                            ? Slippage.deductSlippage(halfAmount, SLIPPAGE_BN)
                            : Slippage.deductSlippage(
                                BigInt(new BigNumber(halfAmount.toString()).div(BTC_PRICE_BN).toFixed(0)),
                                SLIPPAGE_BN.times(2),
                            ),
                        amount1Min: stableIsToken0
                            ? Slippage.deductSlippage(
                                BigInt(new BigNumber(halfAmount.toString()).div(BTC_PRICE_BN).toFixed(0)),
                                SLIPPAGE_BN.times(2),
                            )
                            : Slippage.deductSlippage(halfAmount, SLIPPAGE_BN),
                    },
                    permitAccount0,
                )
        }
        catch (error) {
            console.log(ErrorDecoder.decodeLowLevelCallError(error))

            throw error
        }
    })
})
