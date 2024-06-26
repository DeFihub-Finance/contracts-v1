import hre from 'hardhat'
import { expect } from 'chai'
import type { Pool } from '@uniswap/v3-sdk'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    type AddressLike,
    ErrorDescription,
    type Signer,
    ZeroAddress,
    parseEther,
    type LogDescription,
    type ContractTransactionReceipt,
} from 'ethers'
import { Compare } from '@src/Compare'
import { getUniV3Pool } from '@src/helpers'
import { decodeLowLevelCallError } from '@src/helpers/decode-call-error'
import { getAmounts, parsePriceToTick, UniswapV2ZapHelper, UniswapV3ZapHelper } from '@src/helpers'
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

describe.only('LiquidityManager#invest', () => {
    const amount = parseEther('1000')
    const SLIPPAGE_BN = new BigNumber(0.01)
    const USD_PRICE = 1n

    // prices
    let USD_PRICE_BN: BigNumber
    let BTC_PRICE: bigint
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

    async function deductFees(amount: bigint) {
        return Fees.deductProductFee(
            liquidityManager,
            amount,
            account0,
            permitAccount0,
            hre.ethers.provider,
        )
    }

    async function sortTokensAndPrices(
        token0: TestERC20,
        token0Price: bigint,
        token1: TestERC20,
        token1Price: bigint,
    ) {
        const [addressToken0, addressToken1] = await Promise.all([
            unwrapAddressLike(token0),
            unwrapAddressLike(token1),
        ])

        if (addressToken0.toLowerCase() > addressToken1.toLowerCase()) {
            [
                token0,
                token0Price,
                token1,
                token1Price,
            ] = [token1, token1Price, token0, token0Price]
        }

        return {
            token0,
            token0Price,
            token0PriceBn: new BigNumber(token0Price.toString()),
            token1,
            token1Price,
            token1PriceBn: new BigNumber(token1Price.toString()),
        }
    }

    async function isSameToken(tokenA: AddressLike, tokenB: AddressLike) {
        const [addressTokenA, addressTokenB] = await Promise.all([
            unwrapAddressLike(tokenA),
            unwrapAddressLike(tokenB),
        ])

        return addressTokenA.toLowerCase() === addressTokenB.toLowerCase()
    }

    async function getEncodedSwap(
        amount: bigint,
        outputToken: AddressLike,
        outputTokenPrice: BigNumber,
        protocol: 'uniswapV2' | 'uniswapV3' = 'uniswapV2',
    ) {
        if (!amount || await isSameToken(stablecoin, outputToken))
            return '0x'

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

    function getRangeTicks(
        pool: Pool,
        lowerPricePercentage: number,
        upperPricePercentage: number,
    ) {
        const currentPrice = pool.token0Price.asFraction

        const lowerPrice = currentPrice.subtract(
            currentPrice.divide(lowerPricePercentage),
        ).toFixed(8)

        const upperPrice = currentPrice.add(
            currentPrice.divide(upperPricePercentage),
        ).toFixed(8)

        return {
            tickLower: parsePriceToTick(pool.token0, pool.token1, pool.fee, lowerPrice),
            tickUpper: parsePriceToTick(pool.token0, pool.token1, pool.fee, upperPrice),
        }
    }

    function validateInvestTransaction(
        amount0: bigint,
        token0Price: BigNumber,
        amount1: bigint,
        token1Price: BigNumber,
        receipt: ContractTransactionReceipt | null,
    ) {
        expect(receipt).to.not.be.undefined

        const uniswapV3PoolInterface = UniswapV3Pool__factory.createInterface()
        let eventLog: LogDescription | undefined

        if (receipt?.logs) {
            for (const log of receipt.logs) {
                const parsedLog = uniswapV3PoolInterface.parseLog(log)

                if (parsedLog && parsedLog.name === 'Mint') {
                    eventLog = parsedLog
                    break
                }
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
                new BigNumber(amount0.toString()).times(token0Price)
                    .plus(new BigNumber(amount1.toString()).times(token1Price))
                    .toString(),
            ),
            tolerance: new BigNumber('0.1'),
        })
    }

    beforeEach(async () => {
        ({
            // prices
            USD_PRICE_BN,
            BTC_PRICE,
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

        await stablecoin.connect(account0).mint(account0, amount)
        await stablecoin.connect(account0).approve(liquidityManager, amount)
    })

    it('should add liquidity and mint a position with expected token amounts', async () => {
        const [
            amountWithDeductedFees,
            pool,
            { token0, token0Price, token0PriceBn, token1, token1Price, token1PriceBn },
        ] = await Promise.all([
            deductFees(amount),
            getUniV3Pool(stableBtcLpUniV3),
            sortTokensAndPrices(stablecoin, USD_PRICE, wbtc, BTC_PRICE),
        ])

        // 10% lower and upper
        const { tickLower, tickUpper } = getRangeTicks(pool, 10, 10)

        const { amount0, amount1 } = getAmounts(
            amountWithDeductedFees,
            pool,
            tickLower,
            tickUpper,
            token0PriceBn,
            token1PriceBn,
        )

        const swapAmountToken0 = amount0 * token0Price
        const swapAmountToken1 = amount1 * token1Price

        const [swapToken0, swapToken1] = await Promise.all([
            getEncodedSwap(swapAmountToken0, token0, token0PriceBn),
            getEncodedSwap(swapAmountToken1, token1, token1PriceBn),
        ])

        const receipt = await (
            await liquidityManager
                .connect(account0)
                .investUniswapV3(
                    {
                        positionManager: positionManagerUniV3,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: pool.fee,

                        token0,
                        token1,

                        swapToken0,
                        swapToken1,

                        swapAmountToken0,
                        swapAmountToken1,

                        tickLower,
                        tickUpper,

                        amount0Min: getMinOutput(swapAmountToken0, token0PriceBn),
                        amount1Min: getMinOutput(swapAmountToken1, token1PriceBn),
                    },
                    permitAccount0,
                )
        ).wait()

        validateInvestTransaction(amount0, token0PriceBn, amount1, token1PriceBn, receipt)
    })

    it('should add liquidity using uniswap v2 and v3 swap in the same transaction', async () => {
        const [
            amountWithDeductedFees,
            pool,
            { token0, token0Price, token0PriceBn, token1, token1Price, token1PriceBn },
        ] = await Promise.all([
            deductFees(amount),
            getUniV3Pool(btcEthLpUniV3),
            sortTokensAndPrices(wbtc, BTC_PRICE, weth, ETH_PRICE),
        ])

        // 10% lower and upper
        const { tickLower, tickUpper } = getRangeTicks(pool, 10, 10)

        const { amount0, amount1 } = getAmounts(
            amountWithDeductedFees,
            pool,
            tickLower,
            tickUpper,
            token0PriceBn,
            token1PriceBn,
        )

        const swapAmountToken0 = amount0 * token0Price
        const swapAmountToken1 = amount1 * token1Price

        const [swapToken0, swapToken1] = await Promise.all([
            getEncodedSwap(swapAmountToken0, token0, token0PriceBn),
            getEncodedSwap(swapAmountToken1, token1, token1PriceBn, 'uniswapV3'),
        ])

        const receipt = await (
            await liquidityManager
                .connect(account0)
                .investUniswapV3(
                    {
                        positionManager: positionManagerUniV3,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: pool.fee,

                        token0,
                        token1,

                        swapToken0,
                        swapToken1,

                        swapAmountToken0,
                        swapAmountToken1,

                        tickLower,
                        tickUpper,

                        amount0Min: getMinOutput(swapAmountToken0, token0PriceBn),
                        amount1Min: getMinOutput(swapAmountToken1, token1PriceBn),
                    },
                    permitAccount0,
                )
        ).wait()

        validateInvestTransaction(amount0, token0PriceBn, amount1, token1PriceBn, receipt)
    })

    it('should add liquidity using a price range outside the current price', async () => {
        const [
            amountWithDeductedFees,
            pool,
            { token0, token0Price, token0PriceBn, token1, token1Price, token1PriceBn },
        ] = await Promise.all([
            deductFees(amount),
            getUniV3Pool(stableBtcLpUniV3),
            sortTokensAndPrices(stablecoin, USD_PRICE, wbtc, BTC_PRICE),
        ])

        // 10% lower and -20% upper
        const { tickLower, tickUpper } = getRangeTicks(pool, 10, -20)

        const { amount0, amount1 } = getAmounts(
            amountWithDeductedFees,
            pool,
            tickLower,
            tickUpper,
            token0PriceBn,
            token1PriceBn,
        )

        const swapAmountToken0 = amount0 * token0Price
        const swapAmountToken1 = amount1 * token1Price

        const [swapToken0, swapToken1] = await Promise.all([
            getEncodedSwap(swapAmountToken0, token0, token0PriceBn),
            getEncodedSwap(swapAmountToken1, token1, token1PriceBn),
        ])

        const receipt = await (
            await liquidityManager
                .connect(account0)
                .investUniswapV3(
                    {
                        positionManager: positionManagerUniV3,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: pool.fee,

                        token0,
                        token1,

                        swapToken0,
                        swapToken1,

                        swapAmountToken0,
                        swapAmountToken1,

                        tickLower,
                        tickUpper,

                        amount0Min: swapAmountToken0 ? getMinOutput(swapAmountToken0, token0PriceBn) : swapAmountToken0,
                        amount1Min: swapAmountToken1 ? getMinOutput(swapAmountToken1, token1PriceBn) : swapAmountToken1,
                    },
                    permitAccount0,
                )
        ).wait()

        validateInvestTransaction(amount0, token0PriceBn, amount1, token1PriceBn, receipt)
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
        const { token0, token1 } = await sortTokensAndPrices(stablecoin, USD_PRICE, wbtc, BTC_PRICE)

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
