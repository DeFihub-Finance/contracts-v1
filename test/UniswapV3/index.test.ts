import { BigNumber } from '@ryze-blockchain/ethereum'
import { ERC20Priced, Slippage, UniswapV3 } from '@defihub/shared'
import { ContractTransactionReceipt, parseEther, Signer } from 'ethers'

import { Compare } from '@src/Compare'
import { NetworkService } from '@src/NetworkService'
import { mockTokenWithAddress } from '@src/helpers/mock-token'
import { getEventLog, UniswapV3 as UniswapV3Helpers } from '@src/helpers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    NonFungiblePositionManager,
    TestERC20,
    TestERC20__factory,
    UniswapV3Pool,
    UniswapV3Pool__factory,
} from '@src/typechain'
import { uniswapV3Fixture } from 'test/UniswapV3/fixtures/base.fixture'

describe('Uniswap V3', () => {
    const SLIPPAGE_BN = new BigNumber(0.01)
    const TEN_PERCENT = new BigNumber(0.1)
    const AMOUNT_TO_INVEST = parseEther('1000')
    const AMOUNT_TO_INVEST_BN = new BigNumber(AMOUNT_TO_INVEST.toString()).shiftedBy(-18)

    // prices
    const USD_PRICE_BN = new BigNumber(1)
    const BTC_PRICE = 70_000n
    const BTC_PRICE_BN = new BigNumber(BTC_PRICE.toString())
    const ETH_PRICE = 3_000n
    const ETH_PRICE_BN = new BigNumber(ETH_PRICE.toString())

    // accounts
    let deployer: Signer
    let account1: Signer

    //  tokens
    let stablecoin: TestERC20
    let usdc: TestERC20
    let weth: TestERC20
    let wbtc: TestERC20

    //  external test contracts
    let positionManagerUniV3: NonFungiblePositionManager
    let stableBtcLpUniV3: UniswapV3Pool
    let usdcEthLpUniV3: UniswapV3Pool

    async function mintAndApprove(
        token0: ERC20Priced,
        token1: ERC20Priced,
        amount0: bigint,
        amount1: bigint,
        to: Signer,
    ) {
        const contractToken0 = TestERC20__factory.connect(token0.address, deployer)
        const contractToken1 = TestERC20__factory.connect(token1.address, deployer)

        await contractToken0.mint(to, amount0)
        await contractToken1.mint(to, amount1)

        await contractToken0.connect(to).approve(positionManagerUniV3, amount0)
        await contractToken1.connect(to).approve(positionManagerUniV3, amount1)
    }

    function validateTransaction(
        receipt: ContractTransactionReceipt | null,
        depositedAmount0: bigint,
        depositedAmount1: bigint,
        token0: ERC20Priced,
        token1: ERC20Priced,
    ) {
        const eventLog = getEventLog(
            receipt,
            'Mint',
            UniswapV3Pool__factory.createInterface(),
        )

        const mintedAmount0 = eventLog?.args.amount0
        const mintedAmount1 = eventLog?.args.amount1

        Compare.almostEqualPercentage({
            target: depositedAmount0,
            value: mintedAmount0,
            tolerance: new BigNumber('0.01'),
        })

        Compare.almostEqualPercentage({
            target: depositedAmount1,
            value: mintedAmount1,
            tolerance: new BigNumber('0.01'),
        })

        const valueMintedAmount0 = new BigNumber(mintedAmount0.toString())
            .times(token0.price)
            .shiftedBy(18 - token0.decimals)

        const valueMintedAmount1 = new BigNumber(mintedAmount1.toString())
            .times(token1.price)
            .shiftedBy(18 - token1.decimals)

        Compare.almostEqualPercentage({
            target: AMOUNT_TO_INVEST,
            value: BigInt(
                valueMintedAmount0.plus(valueMintedAmount1).toString(),
            ),
            tolerance: new BigNumber('0.01'),
        })
    }

    beforeEach(async () => {
        ({
            // accounts
            deployer,
            account1,

            // tokens
            stablecoin,
            usdc,
            weth,
            wbtc,

            // external test contracts
            positionManagerUniV3,
            stableBtcLpUniV3,
            usdcEthLpUniV3,
        } = await loadFixture(uniswapV3Fixture))
    })

    describe('Using tokens with same amount of decimals', () => {
        it('should be able to add liquidity with expected token amounts', async () => {
            const pool = await UniswapV3Helpers.getPoolByContract(stableBtcLpUniV3)
            const { token0, token1 } = UniswapV3.sortTokens(
                await mockTokenWithAddress(BTC_PRICE_BN, 18, wbtc),
                await mockTokenWithAddress(USD_PRICE_BN, 18, stablecoin),
            )

            const { amount0, amount1, tickLower, tickUpper } = UniswapV3.getMintPositionInfo(
                AMOUNT_TO_INVEST_BN,
                pool,
                token0.price,
                token1.price,
                TEN_PERCENT,
                TEN_PERCENT,
            )

            await mintAndApprove(
                token0,
                token1,
                amount0,
                amount1,
                account1,
            )

            const receipt = await (await positionManagerUniV3
                .connect(account1)
                .mint({
                    token0: token0.address,
                    token1: token1.address,
                    fee: 3000,
                    tickLower,
                    tickUpper,
                    amount0Desired: amount0.toString(),
                    amount1Desired: amount1.toString(),
                    amount0Min: Slippage.deductSlippage(amount0, SLIPPAGE_BN),
                    amount1Min: Slippage.deductSlippage(amount1, SLIPPAGE_BN),
                    recipient: account1,
                    deadline: await NetworkService.getBlockTimestamp() + 10_000,
                })).wait()

            validateTransaction(receipt, amount0, amount1, token0, token1)
        })
    })

    describe('Using tokens with unusual amount of decimals', () => {
        it('should be able to add liquidity with expected token amounts', async () => {
            const pool = await UniswapV3Helpers.getPoolByContract(usdcEthLpUniV3)
            const { token0, token1 } = UniswapV3.sortTokens(
                await mockTokenWithAddress(USD_PRICE_BN, 6, usdc),
                await mockTokenWithAddress(ETH_PRICE_BN, 18, weth),
            )

            const { amount0, amount1, tickLower, tickUpper } = UniswapV3.getMintPositionInfo(
                AMOUNT_TO_INVEST_BN,
                pool,
                token0.price,
                token1.price,
                TEN_PERCENT,
                TEN_PERCENT,
            )

            await mintAndApprove(
                token0,
                token1,
                amount0,
                amount1,
                account1,
            )

            const receipt = await (await positionManagerUniV3
                .connect(account1)
                .mint({
                    token0: token0.address,
                    token1: token1.address,
                    fee: 3000,
                    tickLower,
                    tickUpper,
                    amount0Desired: amount0.toString(),
                    amount1Desired: amount1.toString(),
                    amount0Min: Slippage.deductSlippage(amount0, SLIPPAGE_BN),
                    amount1Min: Slippage.deductSlippage(amount1, SLIPPAGE_BN),
                    recipient: account1,
                    deadline: await NetworkService.getBlockTimestamp() + 10_000,
                })).wait()

            validateTransaction(receipt, amount0, amount1, token0, token1)
        })
    })
})
