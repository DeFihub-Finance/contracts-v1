import hre from 'hardhat'
import { expect } from 'chai'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    Fees,
    Slippage,
    unwrapAddressLike,
} from '@defihub/shared'
import { LiquidityManagerFixture } from './liquidity-manager.fixture'
import {
    LiquidityManager,
    NonFungiblePositionManager,
    SubscriptionManager,
    TestERC20,
    UniswapV3Pool,
    UniswapV3Pool__factory,
} from '@src/typechain'
import { getAmounts, parsePriceToTick, UniswapV2ZapHelper, UniswapV3ZapHelper } from '@src/helpers'
import { AddressLike, ErrorDescription, Signer, ZeroAddress, parseEther, LogDescription } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { decodeLowLevelCallError } from '@src/helpers/decode-call-error'
import { getUniV3Pool } from '@src/helpers'
import { Compare } from '@src/Compare'

describe.only('LiquidityManager#invest', () => {
    const amount = parseEther('1000')
    const SLIPPAGE_BN = new BigNumber(0.01)

    // prices
    let USD_PRICE_BN: BigNumber
    let BTC_PRICE_BN: BigNumber
    let BTC_PRICE: bigint
    let ETH_PRICE_BN: BigNumber
    let ETH_PRICE: bigint

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
            BTC_PRICE,
            BTC_PRICE_BN,
            ETH_PRICE_BN,
            ETH_PRICE,

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

        await wbtc.connect(account0).mint(account0, amount)
        await weth.connect(account0).mint(account0, amount)
        await stablecoin.connect(account0).mint(account0, amount)
        await stablecoin.connect(account0).approve(liquidityManager, amount)
        await wbtc.connect(account0).approve(positionManagerUniV3, amount)
        await weth.connect(account0).approve(positionManagerUniV3, amount)
    })

    it('should add liquidity using 50/50 token0 and token1 amount proportion', async () => {
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
            .investUniswapV3(
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

    it.only('should add liquidity using different token0 and token1 amount proportions', async () => {
        const [amountWithDeductedFees, pool] = await Promise.all([
            deductFees(amount),
            getUniV3Pool(stableBtcLpUniV3),
        ])

        const stableIsToken0 = await isSameToken(stablecoin, pool.token0.address)

        const currentPrice = pool.token0Price.asFraction

        const currentPrice10Percent = currentPrice.divide(10)
        const currentPrice20Percent = currentPrice.divide(20)

        // 10% lower
        const lowerPrice = currentPrice.subtract(currentPrice10Percent).toFixed(8)
        // 20% upper
        const upperPrice = currentPrice.add(currentPrice20Percent).toFixed(8)

        const tickLower = parsePriceToTick(pool.token0, pool.token1, pool.fee, lowerPrice)
        const tickUpper = parsePriceToTick(pool.token0, pool.token1, pool.fee, upperPrice)
        const price0 = stableIsToken0 ? USD_PRICE_BN : BTC_PRICE_BN
        const price1 = stableIsToken0 ? BTC_PRICE_BN : USD_PRICE_BN

        const { amount0, amount1 } = getAmounts(
            amountWithDeductedFees,
            pool,
            tickLower,
            tickUpper,
            price0,
            price1,
        )

        const swapAmountToken0 = stableIsToken0 ? amount0 : amount0 * BTC_PRICE
        const swapAmountToken1 = stableIsToken0 ? amount1 * BTC_PRICE : amount1

        const amount0Min = getMinOutput(swapAmountToken0, stableIsToken0 ? USD_PRICE_BN : BTC_PRICE_BN)
        const amount1Min = getMinOutput(swapAmountToken1, stableIsToken0 ? BTC_PRICE_BN : USD_PRICE_BN)

        const encodedSwap = await getEncodedSwap(
            stableIsToken0
                ? swapAmountToken1
                : swapAmountToken0,
            wbtc,
            BTC_PRICE_BN,
        )

        const receipt = await (
            await liquidityManager
                .connect(account0)
                .investUniswapV3(
                    {
                        positionManager: positionManagerUniV3,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: 3_000,

                        token0: pool.token0.address,
                        token1: pool.token1.address,

                        swapToken0: stableIsToken0 ? '0x' : encodedSwap,
                        swapToken1: stableIsToken0 ? encodedSwap : '0x',

                        swapAmountToken0,
                        swapAmountToken1,

                        tickLower,
                        tickUpper,

                        amount0Min,
                        amount1Min,
                    },
                    permitAccount0,
                )
        ).wait()

        expect(receipt).to.not.be.undefined

        let eventLog: LogDescription | undefined

        if (receipt?.logs) {
            for (const log of receipt.logs) {
                const parsedLog = UniswapV3Pool__factory
                    .createInterface()
                    .parseLog(log)

                if (parsedLog && parsedLog.name === 'Mint')
                    eventLog = parsedLog
            }
        }

        const mintedAmount0 = eventLog?.args.amount0
        const mintedAmount1 = eventLog?.args.amount1

        Compare.almostEqualPercentage({
            target: amount0,
            value: mintedAmount0,
            tolerance: new BigNumber('0.1'),
        })

        Compare.almostEqualPercentage({
            target: amount1,
            value: mintedAmount1,
            tolerance: new BigNumber('0.1'),
        })

        Compare.almostEqualPercentage({
            target: amount,
            value: BigInt(
                new BigNumber(amount0.toString()).times(price0)
                    .plus(new BigNumber(amount1.toString()).times(price1))
                    .toString(),
            ),
            tolerance: new BigNumber('0.1'),
        })
    })

    it('should add liquidity using uniswap v2 and v3 swap in the same transaction', async () => {
        const halfAmount = amount * 50n / 100n
        const halfAmountWithDeductedFees = await deductFees(halfAmount)

        const [
            { tick },
            tickSpacing,
            { token0, token1 },
            wbtcEncodedSwap,
            wethEncodedSwap,
        ] = await Promise.all([
            btcEthLpUniV3.slot0(),
            btcEthLpUniV3.tickSpacing(),
            sortTokens(wbtc, weth),
            getEncodedSwap(halfAmountWithDeductedFees, wbtc, BTC_PRICE_BN),
            getEncodedSwap(halfAmountWithDeductedFees, weth, ETH_PRICE_BN, 'uniswapV3'),
        ])

        const wbtcIsToken0 = await isSameToken(wbtc, token0)

        const wbtcAmountMin = getMinOutput(halfAmountWithDeductedFees, BTC_PRICE_BN)
        const wethAmountMin = getMinOutput(halfAmountWithDeductedFees, ETH_PRICE_BN)

        await liquidityManager
            .connect(account0)
            .investUniswapV3(
                {
                    positionManager: positionManagerUniV3,
                    inputToken: stablecoin,
                    depositAmountInputToken: amount,

                    fee: 3_000,

                    token0,
                    token1,

                    swapToken0: wbtcIsToken0 ? wbtcEncodedSwap : wethEncodedSwap,
                    swapToken1: wbtcIsToken0 ? wethEncodedSwap : wbtcEncodedSwap,

                    swapAmountToken0: halfAmountWithDeductedFees,
                    swapAmountToken1: halfAmountWithDeductedFees,

                    // TODO calculate tick dinamically using price
                    tickLower: getNearestUsableTick(tick - (tick / 10n), tickSpacing),
                    tickUpper: getNearestUsableTick(tick + (tick / 10n), tickSpacing),

                    amount0Min: wbtcIsToken0 ? wbtcAmountMin : wethAmountMin,
                    amount1Min: wbtcIsToken0 ? wethAmountMin : wbtcAmountMin,
                },
                permitAccount0,
            )
    })

    it('fails if swap amount is greater than deposit amount', async () => {
        try {
            await liquidityManager
                .connect(account0)
                .investUniswapV3(
                    {
                        positionManager: ZeroAddress,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: 0,

                        token0: ZeroAddress,
                        token1: ZeroAddress,

                        swapToken0: '0x',
                        swapToken1: '0x',

                        swapAmountToken0: amount,
                        swapAmountToken1: amount,

                        tickLower: 0,
                        tickUpper: 0,

                        amount0Min: 0,
                        amount1Min: 0,
                    },
                    permitAccount0,
                )
        }
        catch (e) {
            const error = decodeLowLevelCallError(e)

            if (!(error instanceof ErrorDescription))
                throw new Error('Error decoding custom error')

            expect(error.name).to.equal('InsufficientFunds')
        }
    })

    it('fails if position manager is not whitelisted', async () => {
        try {
            await liquidityManager
                .connect(account0)
                .investUniswapV3(
                    {
                        positionManager: ZeroAddress,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: 0,

                        token0: ZeroAddress,
                        token1: ZeroAddress,

                        swapToken0: '0x',
                        swapToken1: '0x',

                        swapAmountToken0: 0,
                        swapAmountToken1: 0,

                        tickLower: 0,
                        tickUpper: 0,

                        amount0Min: 0,
                        amount1Min: 0,
                    },
                    permitAccount0,
                )
        }
        catch (e) {
            const error = decodeLowLevelCallError(e)

            if (!(error instanceof ErrorDescription))
                throw new Error('Error decoding custom error')

            expect(error.name).to.equal('InvalidInvestment')
        }
    })

    it('fails if token0 address is greater than token1 address', async () => {
        const { token0, token1 } = await sortTokens(stablecoin, wbtc)

        try {
            await liquidityManager
                .connect(account0)
                .investUniswapV3(
                    {
                        positionManager: positionManagerUniV3,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: 0,

                        token0: token1,
                        token1: token0,

                        swapToken0: '0x',
                        swapToken1: '0x',

                        swapAmountToken0: 0,
                        swapAmountToken1: 0,

                        tickLower: 0,
                        tickUpper: 0,

                        amount0Min: 0,
                        amount1Min: 0,
                    },
                    permitAccount0,
                )
        }
        catch (e) {
            const error = decodeLowLevelCallError(e)

            if (!(error instanceof ErrorDescription))
                throw new Error('Error decoding custom error')

            expect(error.name).to.equal('InvalidInvestment')
        }
    })
})
