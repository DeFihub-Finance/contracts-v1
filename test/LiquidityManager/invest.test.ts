import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { Slippage } from '@defihub/shared'
import { LiquidityManagerFixture } from './liquidity-manager.fixture'
import {
    LiquidityManager,
    NonFungiblePositionManager,
    StrategyManager,
    SubscriptionManager,
    TestERC20,
} from '@src/typechain'
import { UniswapV2ZapHelper } from '@src/helpers'
import { Signer, ZeroHash, parseEther } from 'ethers'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { ErrorDecoder } from '@src/helpers/ErrorDecoder'

describe.only('LiquidityManager#invest', () => {
    const amount = parseEther('1000')
    const halfAmount = amount * 50n / 100n
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
    let strategyManager: StrategyManager

    // external test contracts
    let positionManagerUniV3: NonFungiblePositionManager

    // global data
    let strategyId: bigint
    let btcEthPoolId: bigint
    let stableBtcPoolId: bigint
    let permitAccount0: SubscriptionManager.PermitStruct

    // helpers
    let uniswapV2ZapHelper: UniswapV2ZapHelper

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
            strategyManager,

            // global data
            strategyId,
            permitAccount0,
            btcEthPoolId,
            stableBtcPoolId,

            // external test contracts
            positionManagerUniV3,

            // helpers
            uniswapV2ZapHelper,
        } = await loadFixture(LiquidityManagerFixture))
    })

    it('should add liquidity', async () => {
        /*
            struct AddLiquidityV3Params {
                address positionManager;
                IERC20Upgradeable inputToken;
                IERC20Upgradeable token0;
                IERC20Upgradeable token1;
                uint24 fee;
                uint depositAmountInputToken;
                bytes swapToken0;
                bytes swapToken1;
                uint swapAmountToken0;
                uint swapAmountToken1;
                int24 tickLower;
                int24 tickUpper;
                uint amount0Min;
                uint amount1Min;
            }
        */

        // TODO remove strategy creation after implementing encode swap without strategyID
        await strategyManager
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
