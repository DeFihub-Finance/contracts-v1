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
    ContractTransactionReceipt,
} from 'ethers'
import { Compare } from '@src/Compare'
import { mockTokenWithAddress } from '@src/helpers/mock-token'
import { decodeLowLevelCallError } from '@src/helpers/decode-call-error'
import { UniswapV2ZapHelper, UniswapV3ZapHelper, UniswapV3 as UniswapV3Helpers, getEventLog } from '@src/helpers'
import { Fees, Slippage, unwrapAddressLike, UniswapV3, ERC20Priced } from '@defihub/shared'
import {
    LiquidityManager,
    NonFungiblePositionManager,
    SubscriptionManager,
    TestERC20,
    UniswapV3Pool,
    UniswapV3Pool__factory,
} from '@src/typechain'
import { zapFixture } from 'test/StrategyManager/fixtures/zap.fixture'

describe('LiquidityManager#invest', () => {
    const amount = parseEther('1000')
    const SLIPPAGE_BN = new BigNumber(0.01)
    let amountWithDeductedFees: BigNumber

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

    async function deductFees(amount: bigint) {
        return Fees.deductProductFee(
            liquidityManager,
            amount,
            account0,
            permitAccount0,
            hre.ethers.provider,
        )
    }

    async function isSameToken(tokenA: AddressLike, tokenB: AddressLike) {
        const [
            addressTokenA,
            addressTokenB,
        ] = await Promise.all([
            unwrapAddressLike(tokenA),
            unwrapAddressLike(tokenB),
        ])

        return addressTokenA.toLowerCase() === addressTokenB.toLowerCase()
    }

    async function getEncodedSwap(
        amount: bigint,
        outputToken: ERC20Priced,
        protocol: 'uniswapV2' | 'uniswapV3' = 'uniswapV2',
    ) {
        if (!amount || await isSameToken(stablecoin, outputToken.address))
            return '0x'

        return protocol === 'uniswapV2'
            ? UniswapV2ZapHelper.encodeSwap(
                amount,
                stablecoin,
                outputToken.address,
                USD_PRICE_BN,
                outputToken.price,
                SLIPPAGE_BN,
                liquidityManager,
            )
            : UniswapV3ZapHelper.encodeExactInputSingle(
                amount,
                stablecoin,
                outputToken.address,
                3000,
                USD_PRICE_BN,
                outputToken.price,
                SLIPPAGE_BN,
                liquidityManager,
            )
    }

    function getMinOutput(amount: bigint, tokenPrice: BigNumber) {
        // Assume its stablecoin
        if (tokenPrice.eq(USD_PRICE_BN))
            return Slippage.deductSlippage(amount, SLIPPAGE_BN)

        const amountBn = new BigNumber(amount.toString())

        // Min output considering that we need to swap the token before
        return Slippage.deductSlippage(
            BigInt(amountBn.div(tokenPrice).toFixed(0)),
            SLIPPAGE_BN.times(2),
        )
    }

    async function invest(
        pool: Pool,
        swapToken0: string,
        swapToken1: string,
        priceToken0: BigNumber,
        priceToken1: BigNumber,
        {
            swapAmountToken0,
            swapAmountToken1,
            tickLower,
            tickUpper,
        }: ReturnType<typeof UniswapV3.getMintPositionInfo>,
    ) {
        return liquidityManager
            .connect(account0)
            .investUniswapV3(
                {
                    positionManager: positionManagerUniV3,
                    inputToken: stablecoin,
                    depositAmountInputToken: amount,

                    fee: pool.fee,

                    token0: pool.token0.address,
                    token1: pool.token1.address,

                    swapToken0,
                    swapToken1,

                    swapAmountToken0,
                    swapAmountToken1,

                    tickLower,
                    tickUpper,

                    amount0Min: getMinOutput(swapAmountToken0, priceToken0),
                    amount1Min: getMinOutput(swapAmountToken1, priceToken1),
                },
                permitAccount0,
            )
    }

    function validateInvestTransaction(
        receipt: ContractTransactionReceipt | null,
        amount0: bigint,
        price0: BigNumber,
        amount1: bigint,
        price1: BigNumber,
    ) {
        expect(receipt).to.be.an.instanceof(ContractTransactionReceipt)

        const eventLog = getEventLog(receipt, 'Mint', UniswapV3Pool__factory.createInterface())

        const mintedAmount0 = eventLog?.args.amount0
        const mintedAmount1 = eventLog?.args.amount1

        Compare.almostEqualPercentage({
            target: amount0,
            value: mintedAmount0,
            tolerance: new BigNumber('0.01'),
        })

        Compare.almostEqualPercentage({
            target: amount1,
            value: mintedAmount1,
            tolerance: new BigNumber('0.01'),
        })

        Compare.almostEqualPercentage({
            target: amount,
            value: BigInt(
                new BigNumber(amount0.toString()).times(price0)
                    .plus(new BigNumber(amount1.toString()).times(price1))
                    .toString(),
            ),
            tolerance: new BigNumber('0.01'),
        })
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
        } = await loadFixture(zapFixture))

        await stablecoin.connect(account0).mint(account0, amount)
        await stablecoin.connect(account0).approve(liquidityManager, amount)

        amountWithDeductedFees = new BigNumber((await deductFees(amount)).toString())
    })

    it('should add liquidity and mint a position with expected token amounts', async () => {
        const pool = await UniswapV3Helpers.getPoolByContract(stableBtcLpUniV3)

        const { token0, token1 } = UniswapV3.sortTokens(
            await mockTokenWithAddress(USD_PRICE_BN, 18, stablecoin),
            await mockTokenWithAddress(BTC_PRICE_BN, 18, wbtc),
        )

        const mintPositionInfo = UniswapV3.getMintPositionInfo(
            amountWithDeductedFees,
            pool,
            token0.price,
            token1.price,
            10, // 10% lower
            10, // 10% upper
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            getEncodedSwap(mintPositionInfo.swapAmountToken0, token0),
            getEncodedSwap(mintPositionInfo.swapAmountToken1, token1),
        ])

        const receipt = await (await invest(
            pool,
            swapToken0,
            swapToken1,
            token0.price,
            token1.price,
            mintPositionInfo,
        )).wait()

        validateInvestTransaction(
            receipt,
            mintPositionInfo.amount0,
            token0.price,
            mintPositionInfo.amount1,
            token1.price,
        )
    })

    it('should add liquidity to a pool that doesnt have a stablecoin, using different swap protocols', async () => {
        const pool = await UniswapV3Helpers.getPoolByContract(btcEthLpUniV3)

        const { token0, token1 } = UniswapV3.sortTokens(
            await mockTokenWithAddress(ETH_PRICE_BN, 18, weth),
            await mockTokenWithAddress(BTC_PRICE_BN, 18, wbtc),
        )

        const mintPositionInfo = UniswapV3.getMintPositionInfo(
            amountWithDeductedFees,
            pool,
            token0.price,
            token1.price,
            10, // 10% lower
            10, // 10% upper
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            getEncodedSwap(mintPositionInfo.swapAmountToken0, token0),
            getEncodedSwap(mintPositionInfo.swapAmountToken1, token1, 'uniswapV3'),
        ])

        const receipt = await (await invest(
            pool,
            swapToken0,
            swapToken1,
            token0.price,
            token1.price,
            mintPositionInfo,
        )).wait()

        validateInvestTransaction(
            receipt,
            mintPositionInfo.amount0,
            token0.price,
            mintPositionInfo.amount1,
            token1.price,
        )
    })

    it('should add liquidity using a price range outside the current price', async () => {
        const pool = await UniswapV3Helpers.getPoolByContract(stableBtcLpUniV3)

        const { token0, token1 } = UniswapV3.sortTokens(
            await mockTokenWithAddress(USD_PRICE_BN, 18, stablecoin),
            await mockTokenWithAddress(BTC_PRICE_BN, 18, wbtc),
        )

        const mintPositionInfo = UniswapV3.getMintPositionInfo(
            amountWithDeductedFees,
            pool,
            token0.price,
            token1.price,
            10, // 10% lower
            -20, // -20% upper
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            getEncodedSwap(mintPositionInfo.swapAmountToken0, token0),
            getEncodedSwap(mintPositionInfo.swapAmountToken1, token1),
        ])

        const receipt = await (await invest(
            pool,
            swapToken0,
            swapToken1,
            token0.price,
            token1.price,
            mintPositionInfo,
        )).wait()

        expect(mintPositionInfo.amount0
            ? mintPositionInfo.amount1
            : mintPositionInfo.amount0).to.be.eq(0)

        validateInvestTransaction(
            receipt,
            mintPositionInfo.amount0,
            token0.price,
            mintPositionInfo.amount1,
            token1.price,
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
        const { token0, token1 } = UniswapV3Helpers.sortTokens(
            await unwrapAddressLike(stablecoin),
            await unwrapAddressLike(wbtc),
        )

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
