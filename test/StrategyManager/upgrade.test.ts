import { expect } from 'chai'
import { parseEther, Signer } from 'ethers'
import { PathUniswapV3, Fees } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'

import { Compare } from '@src/Compare'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { createStrategy, SwapEncoder, UniswapV3 } from '@src/helpers'
import { ETH_PRICE, ETH_PRICE_BN, ETH_QUOTE, ONE_PERCENT, USD_PRICE_BN, USD_QUOTE } from '@src/constants'
import {
    StrategyManager,
    StrategyManager__factory,
    StrategyManager__v2,
    StrategyManager__v2__factory,
    SubscriptionManager,
    TestERC20,
    UniswapPositionManager,
    UniswapV3Factory,
    UniversalRouter,
    UseFee,
} from '@src/typechain'

describe('StrategyManager#upgrade', () => {
    const AMOUNT_TO_INVEST = parseEther('100')
    const ONE_BILLION_ETH = parseEther('1000000000')

    // accounts
    let owner: Signer
    let deployer: Signer
    let account0: Signer

    // tokens
    let weth: TestERC20
    let stablecoin: TestERC20

    // hub contracts
    let strategyManager: StrategyManager
    let dca: UseFee
    let buyProduct: UseFee
    let vaultManager: UseFee
    let liquidityManager: UseFee

    // external test contracts
    let universalRouter: UniversalRouter
    let factoryUniV3: UniswapV3Factory
    let positionManagerUniV3: UniswapPositionManager

    // global data
    let strategyId: bigint
    let permitAccount0: SubscriptionManager.PermitStruct

    async function setStrategyManagerImplementation<
        T extends typeof StrategyManager__factory | typeof StrategyManager__v2__factory
    >(contractFactory: T) {
        await strategyManager.upgradeTo(
            await new contractFactory(deployer).deploy(),
        )

        return contractFactory.connect(
            await strategyManager.getAddress(),
            owner,
        ) as T extends typeof StrategyManager__factory ? StrategyManager : StrategyManager__v2
    }

    function deductFees(amount: bigint) {
        return Fees.deductStrategyFee(
            amount,
            strategyManager,
            strategyId,
            true,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
        )
    }

    async function checkBuyPosition(
        positionId: number,
        investedAmount: bigint,
        strategyManager: StrategyManager__v2,
    ) {
        const { buyPositions } = await strategyManager.getPositionInvestments(account0, positionId)

        Compare.almostEqualPercentage({
            value: buyPositions[0].amount,
            target: BigInt(
                new BigNumber(investedAmount.toString())
                    .div(ETH_PRICE_BN)
                    .toFixed(0),
            ),
            tolerance: ONE_PERCENT,
        })
    }

    beforeEach(async () => {
        ({
            // accounts
            owner,
            deployer,
            account0,

            // tokens
            weth,
            stablecoin,

            // hub contracts
            dca,
            buyProduct,
            vaultManager,
            liquidityManager,
            strategyManager,

            // external test contracts
            universalRouter,
            factoryUniV3,
            positionManagerUniV3,

            // global data
            permitAccount0,
        } = await new ProjectDeployer().deployProjectFixture())

        // "Downgrade" to V1 manager
        const strategyManagerV1 = await setStrategyManagerImplementation(StrategyManager__factory)

        /////////////////////////////////////////////////////
        // Create Strategy with one simple Buy Investment //
        ///////////////////////////////////////////////////
        const investments: Omit<StrategyManager.CreateStrategyParamsStruct, 'permit' | 'metadataHash'> = {
            dcaInvestments: [],
            vaultInvestments: [],
            liquidityInvestments: [],
            buyInvestments: [{ percentage: 100, token: weth }],
        }

        strategyId = await createStrategy(
            account0,
            permitAccount0,
            strategyManagerV1,
            investments,
        )

        //////////////////////////////////
        // Add liquidity to make swaps //
        ////////////////////////////////
        await UniswapV3.mintAndAddLiquidity(
            factoryUniV3,
            positionManagerUniV3,
            weth,
            stablecoin,
            ONE_BILLION_ETH / ETH_PRICE,
            ONE_BILLION_ETH,
            ETH_PRICE_BN,
            USD_PRICE_BN,
            account0,
        )

        ///////////////////////////
        // Invest into strategy //
        /////////////////////////
        await stablecoin.connect(account0).mint(account0, ONE_BILLION_ETH)
        await stablecoin.connect(account0).approve(strategyManagerV1, ONE_BILLION_ETH)

        await strategyManagerV1
            .connect(account0)
            .invest({
                strategyId,
                inputToken: stablecoin,
                inputAmount: AMOUNT_TO_INVEST,
                inputTokenSwap: '0x',
                dcaSwaps: [],
                vaultSwaps: [],
                liquidityZaps: [],
                buySwaps: [
                    await SwapEncoder.encodeExactInputV3(
                        universalRouter,
                        await deductFees(AMOUNT_TO_INVEST),
                        await PathUniswapV3.fromAddressLike(
                            stablecoin,
                            [{ token: weth, fee: 3000 }],
                        ),
                        USD_QUOTE,
                        ETH_QUOTE,
                        new BigNumber(ONE_PERCENT),
                        strategyManager,
                    ),
                ],
                investorPermit: permitAccount0,
                strategistPermit: permitAccount0,
            })
    })

    it('should be able to upgrade StrategyManager to V2 and maintain the same state', async () => {
        const positionBeforeUpgrade = await strategyManager.getPositionInvestments(account0, 0)

        const strategyManagerV2 = await setStrategyManagerImplementation(StrategyManager__v2__factory)

        const positionAfterUpgrade = await strategyManagerV2.getPositionInvestments(account0, 0)

        expect(positionBeforeUpgrade.buyPositions.length).to.equal(1)
        expect(positionAfterUpgrade.buyPositions.length).to.equal(1)
        expect(positionBeforeUpgrade).to.deep.equal(positionAfterUpgrade)
    })

    it('should be able to upgrade StrategyManager to V2 and invest without breaking the contract storage', async () => {
        const strategyManagerV2 = await setStrategyManagerImplementation(StrategyManager__v2__factory)
        const amountMinusFees = await deductFees(AMOUNT_TO_INVEST)

        // First investment to store referrer
        await strategyManagerV2.connect(account0).investV2({
            strategyId,
            inputToken: stablecoin,
            inputAmount: AMOUNT_TO_INVEST,
            inputTokenSwap: '0x',
            dcaSwaps: [],
            vaultSwaps: [],
            liquidityZaps: [],
            buySwaps: [
                await SwapEncoder.encodeExactInputV3(
                    universalRouter,
                    amountMinusFees,
                    await PathUniswapV3.fromAddressLike(
                        stablecoin,
                        [{ token: weth, fee: 3000 }],
                    ),
                    USD_QUOTE,
                    ETH_QUOTE,
                    new BigNumber(ONE_PERCENT),
                    strategyManagerV2,
                ),
            ],
            investorPermit: permitAccount0,
            strategistPermit: permitAccount0,
        }, owner)

        await checkBuyPosition(1, amountMinusFees, strategyManagerV2)

        // Second investment to ensure we don't break the contract storage
        await strategyManagerV2.connect(account0).invest({
            strategyId,
            inputToken: stablecoin,
            inputAmount: AMOUNT_TO_INVEST,
            inputTokenSwap: '0x',
            dcaSwaps: [],
            vaultSwaps: [],
            liquidityZaps: [],
            buySwaps: [
                await SwapEncoder.encodeExactInputV3(
                    universalRouter,
                    amountMinusFees,
                    await PathUniswapV3.fromAddressLike(
                        stablecoin,
                        [{ token: weth, fee: 3000 }],
                    ),
                    USD_QUOTE,
                    ETH_QUOTE,
                    new BigNumber(ONE_PERCENT),
                    strategyManagerV2,
                ),
            ],
            investorPermit: permitAccount0,
            strategistPermit: permitAccount0,
        })

        await checkBuyPosition(2, amountMinusFees, strategyManagerV2)
    })

    it('should be able to upgrade StrategyManager to V2 and collect strategist rewards', async () => {
        const stableBalanceBefore = await stablecoin.balanceOf(account0)
        const strategyManagerV2 = await setStrategyManagerImplementation(StrategyManager__v2__factory)

        await strategyManagerV2.connect(account0).collectStrategistRewards()
        const stableBalanceDelta = await stablecoin.balanceOf(account0) - stableBalanceBefore

        const { strategistFee } = await Fees.getStrategyFeeAmount(
            AMOUNT_TO_INVEST,
            strategyManagerV2,
            strategyId,
            true,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
        )

        expect(stableBalanceDelta).to.equal(strategistFee)
    })
})
