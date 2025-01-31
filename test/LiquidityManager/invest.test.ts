import { expect } from 'chai'
import type { Pool } from '@uniswap/v3-sdk'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { Fees, unwrapAddressLike, UniswapV3, ERC20Priced, PathUniswapV3 } from '@defihub/shared'
import {
    type Signer,
    parseEther,
    parseUnits,
    ContractTransactionReceipt,
} from 'ethers'
import { Compare } from '@src/Compare'
import { mockTokenWithAddress } from '@src/helpers/mock-token'
import {
    UniswapV3 as UniswapV3Helpers,
    getEventLog,
    LiquidityHelpers,
    SwapEncoder,
    expectCustomError,
} from '@src/helpers'
import {
    LiquidityManager,
    NonFungiblePositionManager,
    SubscriptionManager,
    TestERC20,
    UniswapV3Pool,
    UniswapV3Pool__factory,
    UniversalRouter,
} from '@src/typechain'
import { zapFixture } from 'test/StrategyManager/fixtures/zap.fixture'
import { BTC_PRICE_BN, ETH_PRICE_BN, ONE_PERCENT, USD_PRICE_BN } from '@src/constants'

describe('LiquidityManager#invest', () => {
    const amount = parseEther('1000')
    const SLIPPAGE_BN = ONE_PERCENT
    const TEN_PERCENT = new BigNumber(0.1)

    let amountWithDeductedFees: BigNumber
    let inputToken: ERC20Priced

    // accounts
    let account0: Signer

    // tokens
    let stablecoin: TestERC20
    let usdc: TestERC20
    let weth: TestERC20
    let wbtc: TestERC20

    // hub contracts
    let liquidityManager: LiquidityManager

    // external test contracts
    let universalRouter: UniversalRouter
    let positionManagerUniV3: NonFungiblePositionManager
    let stableBtcLpUniV3: UniswapV3Pool
    let usdcEthLpUniV3: UniswapV3Pool
    let btcEthLpUniV3: UniswapV3Pool

    // global data
    let permitAccount0: SubscriptionManager.PermitStruct

    async function deductFees(amount: bigint) {
        return Fees.deductProductFee(amount, true, liquidityManager)
    }

    async function getEncodedSwap(
        amount: bigint,
        inputToken: ERC20Priced,
        outputToken: ERC20Priced,
        protocol: 'uniswapV2' | 'uniswapV3' = 'uniswapV2',
    ) {
        if (!amount || inputToken.address === outputToken.address)
            return '0x'

        return protocol === 'uniswapV2'
            ? SwapEncoder.encodeExactInputV2(
                universalRouter,
                amount,
                [inputToken.address, outputToken.address],
                inputToken,
                outputToken,
                SLIPPAGE_BN,
                liquidityManager,
            )
            : SwapEncoder.encodeExactInputV3(
                universalRouter,
                amount,
                new PathUniswapV3(
                    inputToken.address,
                    [{ fee: 3000, token: outputToken.address }],
                ),
                inputToken,
                outputToken,
                SLIPPAGE_BN,
                liquidityManager,
            )
    }

    async function invest(
        pool: Pool,
        token0: ERC20Priced,
        token1: ERC20Priced,
        swapToken0: string,
        swapToken1: string,
        {
            swapAmountToken0,
            swapAmountToken1,
            tickLower,
            tickUpper,
        }: ReturnType<typeof UniswapV3.getMintPositionInfo>,
        _inputToken = inputToken,
        depositAmountInputToken = amount,
    ) {
        return liquidityManager
            .connect(account0)
            .investUniswapV3(
                {
                    positionManager: positionManagerUniV3,
                    inputToken: _inputToken.address,
                    depositAmountInputToken,

                    fee: pool.fee,

                    token0: pool.token0.address,
                    token1: pool.token1.address,

                    swapToken0,
                    swapToken1,

                    swapAmountToken0,
                    swapAmountToken1,

                    tickLower,
                    tickUpper,

                    amount0Min: LiquidityHelpers.getMinOutput(swapAmountToken0, inputToken, token0),
                    amount1Min: LiquidityHelpers.getMinOutput(swapAmountToken1, inputToken, token1),
                },
                permitAccount0,
            )
    }

    function validateInvestTransaction(
        receipt: ContractTransactionReceipt | null,
        token0: ERC20Priced,
        token1: ERC20Priced,
        amount0: bigint,
        amount1: bigint,
        _inputToken = inputToken,
        depositedAmount = amount,
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

        const valueMintedAmount0 = new BigNumber(mintedAmount0.toString())
            .times(token0.price)
            .shiftedBy(_inputToken.decimals - token0.decimals)

        const valueMintedAmount1 = new BigNumber(mintedAmount1.toString())
            .times(token1.price)
            .shiftedBy(_inputToken.decimals - token1.decimals)

        Compare.almostEqualPercentage({
            target: depositedAmount,
            value: BigInt(
                valueMintedAmount0.plus(valueMintedAmount1).toFixed(0),
            ),
            tolerance: new BigNumber('0.01'),
        })
    }

    beforeEach(async () => {
        ({
            // accounts
            account0,

            // tokens
            usdc,
            weth,
            wbtc,
            stablecoin,

            // hub contracts
            liquidityManager,

            // global data
            permitAccount0,

            // external test contracts
            universalRouter,
            positionManagerUniV3,
            stableBtcLpUniV3,
            usdcEthLpUniV3,
            btcEthLpUniV3,
        } = await loadFixture(zapFixture))

        await stablecoin.connect(account0).mint(account0, amount)
        await stablecoin.connect(account0).approve(liquidityManager, amount)

        inputToken = await mockTokenWithAddress(USD_PRICE_BN, 18, stablecoin)
        amountWithDeductedFees = new BigNumber(
            (await deductFees(amount)).toString(),
        ).shiftedBy(-inputToken.decimals)
    })

    it('should add liquidity and mint a position with expected token amounts', async () => {
        const pool = await UniswapV3Helpers.getPoolByContract(stableBtcLpUniV3)

        const { token0, token1 } = UniswapV3.sortTokens(
            await mockTokenWithAddress(USD_PRICE_BN, 18, stablecoin),
            await mockTokenWithAddress(BTC_PRICE_BN, 18, wbtc),
        )

        const mintPositionInfo = UniswapV3.getMintPositionInfo(
            inputToken,
            amountWithDeductedFees,
            pool,
            token0.price,
            token1.price,
            TEN_PERCENT.negated(), // 10% lower
            TEN_PERCENT, // 10% upper
            true,
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            getEncodedSwap(mintPositionInfo.swapAmountToken0, inputToken, token0),
            getEncodedSwap(mintPositionInfo.swapAmountToken1, inputToken, token1),
        ])

        const receipt = await (await invest(
            pool,
            token0,
            token1,
            swapToken0,
            swapToken1,
            mintPositionInfo,
        )).wait()

        validateInvestTransaction(
            receipt,
            token0,
            token1,
            mintPositionInfo.amount0,
            mintPositionInfo.amount1,
        )
    })

    it('should add liquidity to a pool that doesnt have a stablecoin, using different swap protocols', async () => {
        const pool = await UniswapV3Helpers.getPoolByContract(btcEthLpUniV3)

        const { token0, token1 } = UniswapV3.sortTokens(
            await mockTokenWithAddress(ETH_PRICE_BN, 18, weth),
            await mockTokenWithAddress(BTC_PRICE_BN, 18, wbtc),
        )

        const mintPositionInfo = UniswapV3.getMintPositionInfo(
            inputToken,
            amountWithDeductedFees,
            pool,
            token0.price,
            token1.price,
            TEN_PERCENT.negated(), // 10% lower
            TEN_PERCENT, // 10% upper
            true,
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            getEncodedSwap(mintPositionInfo.swapAmountToken0, inputToken, token0),
            getEncodedSwap(mintPositionInfo.swapAmountToken1, inputToken, token1, 'uniswapV3'),
        ])

        const receipt = await (await invest(
            pool,
            token0,
            token1,
            swapToken0,
            swapToken1,
            mintPositionInfo,
        )).wait()

        validateInvestTransaction(
            receipt,
            token0,
            token1,
            mintPositionInfo.amount0,
            mintPositionInfo.amount1,
        )
    })

    it('should add liquidity using a price range outside the current price', async () => {
        const pool = await UniswapV3Helpers.getPoolByContract(stableBtcLpUniV3)

        const { token0, token1 } = UniswapV3.sortTokens(
            await mockTokenWithAddress(USD_PRICE_BN, 18, stablecoin),
            await mockTokenWithAddress(BTC_PRICE_BN, 18, wbtc),
        )

        const mintPositionInfo = UniswapV3.getMintPositionInfo(
            inputToken,
            amountWithDeductedFees,
            pool,
            token0.price,
            token1.price,
            TEN_PERCENT.negated(), // 10% lower
            new BigNumber(-0.05), // -5% upper
            true,
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            getEncodedSwap(mintPositionInfo.swapAmountToken0, inputToken, token0),
            getEncodedSwap(mintPositionInfo.swapAmountToken1, inputToken, token1),
        ])

        const receipt = await (await invest(
            pool,
            token0,
            token1,
            swapToken0,
            swapToken1,
            mintPositionInfo,
        )).wait()

        expect(mintPositionInfo.amount0
            ? mintPositionInfo.amount1
            : mintPositionInfo.amount0).to.be.eq(0)

        validateInvestTransaction(
            receipt,
            token0,
            token1,
            mintPositionInfo.amount0,
            mintPositionInfo.amount1,
        )
    })

    it('should be able to add liquidity to a pool that have a token with unusual amount of decimals', async () => {
        const pool = await UniswapV3Helpers.getPoolByContract(usdcEthLpUniV3)

        const { token0, token1 } = UniswapV3.sortTokens(
            await mockTokenWithAddress(USD_PRICE_BN, 6, usdc),
            await mockTokenWithAddress(ETH_PRICE_BN, 18, weth),
        )

        const mintPositionInfo = UniswapV3.getMintPositionInfo(
            inputToken,
            amountWithDeductedFees,
            pool,
            token0.price,
            token1.price,
            TEN_PERCENT.negated(),
            TEN_PERCENT,
            true,
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            getEncodedSwap(mintPositionInfo.swapAmountToken0, inputToken, token0, 'uniswapV3'),
            getEncodedSwap(mintPositionInfo.swapAmountToken1, inputToken, token1, 'uniswapV3'),
        ])

        const receipt = await (await invest(
            pool,
            token0,
            token1,
            swapToken0,
            swapToken1,
            mintPositionInfo,
        )).wait()

        validateInvestTransaction(
            receipt,
            token0,
            token1,
            mintPositionInfo.amount0,
            mintPositionInfo.amount1,
        )
    })

    it('should be able to add liquidity using an input token with unusual amount of decimals', async () => {
        const depositAmountUsdc = parseUnits('1000', 6)

        await usdc.connect(account0).mint(account0, depositAmountUsdc)
        await usdc.connect(account0).approve(liquidityManager, depositAmountUsdc)

        const inputToken = await mockTokenWithAddress(USD_PRICE_BN, 6, usdc)
        const amountWithDeductedFees = new BigNumber(
            (await deductFees(depositAmountUsdc)).toString(),
        ).shiftedBy(-inputToken.decimals)

        const pool = await UniswapV3Helpers.getPoolByContract(usdcEthLpUniV3)

        const { token0, token1 } = UniswapV3.sortTokens(
            inputToken,
            await mockTokenWithAddress(ETH_PRICE_BN, 18, weth),
        )

        const mintPositionInfo = UniswapV3.getMintPositionInfo(
            inputToken,
            amountWithDeductedFees,
            pool,
            token0.price,
            token1.price,
            TEN_PERCENT.negated(),
            TEN_PERCENT,
            true,
        )

        const [
            swapToken0,
            swapToken1,
        ] = await Promise.all([
            getEncodedSwap(mintPositionInfo.swapAmountToken0, inputToken, token0, 'uniswapV3'),
            getEncodedSwap(mintPositionInfo.swapAmountToken1, inputToken, token1, 'uniswapV3'),
        ])

        const receipt = await (await invest(
            pool,
            token0,
            token1,
            swapToken0,
            swapToken1,
            mintPositionInfo,
            inputToken,
            depositAmountUsdc,
        )).wait()

        validateInvestTransaction(
            receipt,
            token0,
            token1,
            mintPositionInfo.amount0,
            mintPositionInfo.amount1,
            inputToken,
            depositAmountUsdc,
        )
    })

    it('fails if swap amount is greater than deposit amount', async () => {
        const { token0, token1 } = UniswapV3Helpers.sortTokens(
            await unwrapAddressLike(stablecoin),
            await unwrapAddressLike(wbtc),
        )

        await expect(
            liquidityManager
                .connect(account0)
                .investUniswapV3(
                    {
                        positionManager: positionManagerUniV3,
                        inputToken: stablecoin,
                        depositAmountInputToken: amount,

                        fee: 0,

                        token0,
                        token1,

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
                ),
        ).to.be.revertedWithCustomError(liquidityManager, 'InsufficientFunds')
    })

    it('fails if token0 address is greater than token1 address', async () => {
        const { token0, token1 } = UniswapV3Helpers.sortTokens(
            await unwrapAddressLike(stablecoin),
            await unwrapAddressLike(wbtc),
        )

        await expectCustomError(
            liquidityManager
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
                ),
            'InvalidInvestment',
        )
    })
})
