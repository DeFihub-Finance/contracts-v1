import { expect } from 'chai'
import { AbiCoder, parseEther, Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    StrategyInvestor,
    StrategyInvestor__factory,
    StrategyManager__v2,
    SubscriptionManager,
    TestERC20,
    TestVault,
    UniswapPositionManager,
    UniswapV3Factory,
    UniversalRouter,
    UseFee,
} from '@src/typechain'
import { createStrategyFixture } from './fixtures/create-strategy.fixture'
import {
    expectCustomError,
    getEventLog,
    LiquidityHelpers,
    SwapEncoder,
    UniswapV3 as UniswapV3Helper,
} from '@src/helpers'
import { ERC20Priced, PathUniswapV3, Slippage, UniswapV3, unwrapAddressLike } from '@defihub/shared'
import { Fees } from '@src/helpers/Fees'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { Compare } from '@src/Compare'
import { ONE_PERCENT } from '@src/constants'
import { BigNumber } from '@ryze-blockchain/ethereum'

// EFFECTS
// => when user is subscribed
//      => create investment position in dca and vaults discounting protocol fee - subscriber discount
// => when user is not subscribed
//      => create investment position in dca and vaults discounting protocol fee
// => when strategist is subscribed and strategy is hot
//      => send fees to strategist
//      => send fees to treasury
// => when strategist is subscribed and strategy is not hot
//      => send fees to strategist
//      => send fees to treasury
// => emit Invested event
// => swap and create investment position
// => invest with native
//
// SIDE-EFFECTS
// => save position in the array of investments
//
// REVERTS
// => when strategist is not subscribed
//      => revert transaction => TODO: this should change to not send fees to strategist
// => if strategyId doesn't exist
// => if swap paths are different than the vaults length in strategy
// => if swap paths are different than the dca length in strategy
describe('StrategyManager#invest', () => {
    const SLIPPAGE_BN = ONE_PERCENT
    const amountToInvest = parseEther('10')

    // accounts
    /** strategist */
    let account0: Signer
    /** Subscribed Investor */
    let account1: Signer
    /** Non Subscribed Investor */
    let account2: Signer
    let treasury: Signer

    // tokens
    let stablecoin: TestERC20
    let stablecoinPriced: ERC20Priced
    let wethPriced: ERC20Priced

    // hub contracts
    let strategyManager: StrategyManager__v2
    let vault: TestVault
    let dca: DollarCostAverage
    let liquidityManager: UseFee
    let vaultManager: UseFee
    let buyProduct: UseFee

    // external test contracts
    let universalRouter: UniversalRouter
    let positionManagerUniV3: UniswapPositionManager
    let factoryUniV3: UniswapV3Factory

    // global data
    let deadline: number
    let subscriptionSignature: SubscriptionSignature
    let permitAccount0: SubscriptionManager.PermitStruct
    let expiredPermitAccount0: SubscriptionManager.PermitStruct

    let strategyId: bigint
    let erc20PricedMap: Map<string, ERC20Priced>

    function getPricedTokenOrFail(address: string) {
        const token = erc20PricedMap.get(address)

        if (!token)
            throw new Error(`Unable to find ERC20Priced with address ${ address }`)

        return token
    }

    function deductFees(
        amount: bigint,
        _strategyId: bigint = strategyId,
        subscribedUser = true,
        subscribedStrategist = true,
    ) {
        return Fees.deductStrategyFee(
            amount,
            strategyManager,
            _strategyId,
            subscribedUser,
            subscribedStrategist,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
        )
    }

    function getStrategyFeeAmount(
        amount: bigint,
        _strategyId: bigint = strategyId,
        subscribedUser = true,
        subscribedStrategist = true,
    ) {
        return Fees.getStrategyFeeAmount(
            amount,
            strategyManager,
            _strategyId,
            subscribedUser,
            subscribedStrategist,
            dca,
            vaultManager,
            liquidityManager,
            buyProduct,
        )
    }

    function parseToStableAmount(amount: bigint, token: ERC20Priced) {
        const parsedStableAmountWithDecimals = new BigNumber(amount.toString())
            .shiftedBy(stablecoinPriced.decimals - token.decimals)
            .times(token.price)
            .toFixed(0)

        return Slippage.deductSlippage(BigInt(parsedStableAmountWithDecimals), SLIPPAGE_BN)
    }

    async function getEncodedSwapV3(
        amount: bigint,
        inputToken: ERC20Priced,
        outputToken: ERC20Priced,
        fromNative = false,
    ) {
        if (inputToken.address === stablecoinPriced.address || amount === 0n)
            return '0x'

        const encodingFunction = fromNative
            ? SwapEncoder.encodeExactNativeInputV3
            : SwapEncoder.encodeExactInputV3

        return encodingFunction(
            universalRouter,
            amount,
            new PathUniswapV3(inputToken.address, [{ fee: 3000, token: outputToken.address }]),
            inputToken,
            outputToken,
            SLIPPAGE_BN,
            strategyManager,
        )
    }

    // Retrieves base invest params between default invest and native invest.
    async function getBaseInvestParams(
        strategyId: bigint,
        amountToInvest: bigint,
        inputToken: ERC20Priced,
        investor: Signer,
        {
            investorSubscribed = true,
            strategistSubscribed = true,
            isNativeInvest = false,
        }: {
            investorSubscribed?: boolean
            strategistSubscribed?: boolean
            isNativeInvest?: boolean
        } = {
            investorSubscribed: true,
            strategistSubscribed: true,
            isNativeInvest: false,
        },
    ) {
        const deadlineInvestor = investorSubscribed ? deadline : 0

        const stableAmount = inputToken.address === stablecoinPriced.address
            ? amountToInvest
            : parseToStableAmount(amountToInvest, inputToken)

        const [
            { dcaInvestments, vaultInvestments, liquidityInvestments },
            amountWithDeductedFees,
            inputTokenSwap,
            investorPermit,
        ] = await Promise.all([
            strategyManager.getStrategyInvestments(strategyId),
            deductFees(stableAmount, strategyId, investorSubscribed, strategistSubscribed),
            getEncodedSwapV3(amountToInvest, inputToken, stablecoinPriced, isNativeInvest),
            subscriptionSignature
                .signSubscriptionPermit(await investor.getAddress(), deadlineInvestor),
        ])

        const liquidityZaps = await Promise.all(liquidityInvestments.map(
            investment => LiquidityHelpers.getLiquidityZap(
                universalRouter,
                amountWithDeductedFees,
                investment,
                stablecoinPriced,
                getPricedTokenOrFail(investment.token0),
                getPricedTokenOrFail(investment.token1),
                factoryUniV3,
                liquidityManager,
                SLIPPAGE_BN,
            ),
        ))

        return {
            strategyId,
            inputTokenSwap,
            dcaSwaps: dcaInvestments.map(_ => '0x'),
            vaultSwaps: vaultInvestments.map(_ => '0x'),
            liquidityZaps,
            buySwaps: [], // TODO
            investorPermit,
            strategistPermit: strategistSubscribed ? permitAccount0 : expiredPermitAccount0,
        }
    }

    async function getInvestParams(investor: Signer, {
        amount = amountToInvest,
        inputToken = stablecoinPriced,
        _strategyId = strategyId,
        investorSubscribed = true,
        strategistSubscribed = true,
    }: {
        amount?: bigint,
        inputToken?: ERC20Priced,
        _strategyId?: bigint,
        investorSubscribed?: boolean,
        strategistSubscribed?: boolean,
    } = {
        amount: amountToInvest,
        inputToken: stablecoinPriced,
        _strategyId: strategyId,
        investorSubscribed: true,
        strategistSubscribed: true,
    }): Promise<StrategyInvestor.InvestParamsStruct> {
        return {
            ...await getBaseInvestParams(
                _strategyId,
                amount,
                inputToken,
                investor,
                { investorSubscribed, strategistSubscribed },
            ),
            inputToken: inputToken.address,
            inputAmount: amount,
        }
    }

    async function getInvestNativeParams(
        investor: Signer,
        {
            amount = amountToInvest,
            _strategyId = strategyId,
            investorSubscribed = true,
            strategistSubscribed = true,
        }: Parameters<typeof getInvestParams>[1] = {
            amount: amountToInvest,
            _strategyId: strategyId,
            investorSubscribed: true,
            strategistSubscribed: true,
        },
    ): Promise<StrategyInvestor.InvestNativeParamsStruct> {
        return getBaseInvestParams(
            _strategyId,
            amount,
            wethPriced,
            investor,
            { investorSubscribed, strategistSubscribed, isNativeInvest: true },
        )
    }

    async function _invest(
        investor: Signer,
        investParams?: StrategyInvestor.InvestParamsStruct,
    ) {
        return strategyManager
            .connect(investor)
            .invest(investParams || await getInvestParams(investor))
    }

    async function _investNative(
        investor: Signer,
        investParams?: StrategyInvestor.InvestNativeParamsStruct,
        value = amountToInvest,
    ) {
        return strategyManager
            .connect(investor)
            .investNative(investParams || await getInvestNativeParams(investor), { value })
    }

    beforeEach(async () => {
        ({
            // accounts
            account0,
            account1,
            account2,
            treasury,

            // tokens
            wethPriced,
            stablecoin,
            stablecoinPriced,

            // hub contracts
            strategyManager,
            dca,
            vault,
            liquidityManager,
            vaultManager,
            buyProduct,

            // external test contracts
            universalRouter,
            positionManagerUniV3,
            factoryUniV3,

            // global data
            strategyId,
            deadline,
            erc20PricedMap,
            permitAccount0,
            expiredPermitAccount0,
            subscriptionSignature,
        } = await loadFixture(createStrategyFixture))
    })

    describe('EFFECTS', () => {
        describe('when user is subscribed', () => {
            it('create investment position in dca, vaults and liquidity', async () => {
                const investParams = await getInvestParams(account1)

                await _invest(account1, investParams)

                const [
                    dcaPosition0,
                    dcaPosition1,
                    dcaPositionBalance0,
                    dcaPositionBalance1,
                    amountWithDeductedFees,
                    investments,
                    { liquidityPositions, vaultPositions },
                ] = await Promise.all([
                    dca.getPosition(strategyManager, 0),
                    dca.getPosition(strategyManager, 1),
                    dca.getPositionBalances(strategyManager, 0),
                    dca.getPositionBalances(strategyManager, 1),
                    deductFees(amountToInvest),
                    strategyManager.getStrategyInvestments(strategyId),
                    strategyManager.getPositionInvestments(account1, 0),
                ])

                /////////////////////
                // DCA Position 0 //
                ///////////////////
                expect(dcaPosition0.swaps).to.be.equal(investments.dcaInvestments[0].swaps)
                expect(dcaPosition0.poolId).to.be.equal(investments.dcaInvestments[0].poolId)
                expect(dcaPositionBalance0.inputTokenBalance)
                    .to.be.equal(amountWithDeductedFees * investments.dcaInvestments[0].percentage / 100n)

                /////////////////////
                // DCA Position 1 //
                ///////////////////
                expect(dcaPosition1.swaps).to.be.equal(investments.dcaInvestments[1].swaps)
                expect(dcaPosition1.poolId).to.be.equal(investments.dcaInvestments[1].poolId)
                expect(dcaPositionBalance1.inputTokenBalance)
                    .to.be.equal(amountWithDeductedFees * investments.dcaInvestments[1].percentage / 100n)

                ////////////////////
                // VaultPosition //
                //////////////////
                expect(vaultPositions[0].vault).to.be.equal(await vault.getAddress())
                expect(vaultPositions[0].amount)
                    .to.be.equal(amountWithDeductedFees * investments.vaultInvestments[0].percentage / 100n)

                ////////////////////////
                // LiquidityPosition //
                //////////////////////
                const {
                    token0,
                    token1,
                    fee,
                    tickLower,
                    tickUpper,
                    liquidity,
                } = await positionManagerUniV3
                    .positions(liquidityPositions[0].tokenId)

                const { amount0, amount1 } = UniswapV3.getPositionTokenAmounts(
                    await UniswapV3Helper.getPoolByFactoryContract(
                        factoryUniV3,
                        token0,
                        token1,
                        fee,
                    ),
                    liquidity,
                    tickLower,
                    tickUpper,
                )

                const pricedToken0 = getPricedTokenOrFail(token0)
                const pricedToken1 = getPricedTokenOrFail(token1)

                expect(fee).to.be.equal(investments.liquidityInvestments[0].fee)
                expect(token0).to.be.equal(investments.liquidityInvestments[0].token0)
                expect(token1).to.be.equal(investments.liquidityInvestments[0].token1)

                expect(tickLower).to.be.equal(investParams.liquidityZaps[0].tickLower)
                expect(tickUpper).to.be.equal(investParams.liquidityZaps[0].tickUpper)

                expect(liquidity).to.be.equal(liquidityPositions[0].liquidity)
                expect(await positionManagerUniV3.getAddress()).to.be.equal(liquidityPositions[0].positionManager)

                Compare.almostEqualPercentage({
                    value: amountWithDeductedFees * investments.liquidityInvestments[0].percentage / 100n,
                    target: BigInt(
                        pricedToken0.price.times(amount0.toString())
                            .plus(pricedToken1.price.times(amount1.toString()))
                            .toFixed(0),
                    ),
                    tolerance: ONE_PERCENT,
                })
            })
        })

        describe('when user is not subscribed', () => {
            it('create investment position in dca, vaults and liquidity', async () => {
                const investParams = await getInvestParams(account2, { investorSubscribed: false })

                await _invest(account2, investParams)

                const [
                    dcaPosition0,
                    dcaPosition1,
                    dcaPositionBalance0,
                    dcaPositionBalance1,
                    amountWithDeductedFees,
                    investments,
                    { liquidityPositions, vaultPositions },
                ] = await Promise.all([
                    dca.getPosition(strategyManager, 0),
                    dca.getPosition(strategyManager, 1),
                    dca.getPositionBalances(strategyManager, 0),
                    dca.getPositionBalances(strategyManager, 1),
                    deductFees(amountToInvest, strategyId, false),
                    strategyManager.getStrategyInvestments(strategyId),
                    strategyManager.getPositionInvestments(account2, 0),
                ])

                /////////////////////
                // DCA Position 0 //
                ///////////////////
                expect(dcaPosition0.swaps).to.be.equal(investments.dcaInvestments[0].swaps)
                expect(dcaPosition0.poolId).to.be.equal(investments.dcaInvestments[0].poolId)
                expect(dcaPositionBalance0.inputTokenBalance)
                    .to.be.equal(amountWithDeductedFees * investments.dcaInvestments[0].percentage / 100n)

                /////////////////////
                // DCA Position 1 //
                ///////////////////
                expect(dcaPosition1.swaps).to.be.equal(investments.dcaInvestments[1].swaps)
                expect(dcaPosition1.poolId).to.be.equal(investments.dcaInvestments[1].poolId)
                expect(dcaPositionBalance1.inputTokenBalance)
                    .to.be.equal(amountWithDeductedFees * investments.dcaInvestments[0].percentage / 100n)

                ////////////////////
                // VaultPosition //
                //////////////////
                expect(vaultPositions[0].vault).to.be.equal(await vault.getAddress())
                expect(vaultPositions[0].amount)
                    .to.be.equal(amountWithDeductedFees * investments.vaultInvestments[0].percentage / 100n)

                ////////////////////////
                // LiquidityPosition //
                //////////////////////
                const {
                    token0,
                    token1,
                    fee,
                    tickLower,
                    tickUpper,
                    liquidity,
                } = await positionManagerUniV3
                    .positions(liquidityPositions[0].tokenId)

                const { amount0, amount1 } = UniswapV3.getPositionTokenAmounts(
                    await UniswapV3Helper.getPoolByFactoryContract(
                        factoryUniV3,
                        token0,
                        token1,
                        fee,
                    ),
                    liquidity,
                    tickLower,
                    tickUpper,
                )

                const pricedToken0 = getPricedTokenOrFail(token0)
                const pricedToken1 = getPricedTokenOrFail(token1)

                expect(fee).to.be.equal(investments.liquidityInvestments[0].fee)
                expect(token0).to.be.equal(investments.liquidityInvestments[0].token0)
                expect(token1).to.be.equal(investments.liquidityInvestments[0].token1)

                expect(tickLower).to.be.equal(investParams.liquidityZaps[0].tickLower)
                expect(tickUpper).to.be.equal(investParams.liquidityZaps[0].tickUpper)

                expect(liquidity).to.be.equal(liquidityPositions[0].liquidity)
                expect(await positionManagerUniV3.getAddress()).to.be.equal(liquidityPositions[0].positionManager)

                Compare.almostEqualPercentage({
                    value: amountWithDeductedFees * investments.liquidityInvestments[0].percentage / 100n,
                    target: BigInt(
                        pricedToken0.price.times(amount0.toString())
                            .plus(pricedToken1.price.times(amount1.toString()))
                            .toFixed(0),
                    ),
                    tolerance: ONE_PERCENT,
                })
            })
        })

        describe('when strategist is subscribed and strategy is not hot', async () => {
            it('increase strategist rewards and send fees to treasury', async () => {
                const treasuryBalanceBefore = await stablecoin.balanceOf(treasury)
                const strategistRewardsBefore = await strategyManager.getStrategistRewards(account0)

                await _invest(account1)

                const { strategistFee, protocolFee } = await getStrategyFeeAmount(amountToInvest)

                const treasuryBalanceDelta = (await stablecoin.balanceOf(treasury)) - treasuryBalanceBefore
                const strategistRewardsDelta = (await strategyManager.getStrategistRewards(account0)) - strategistRewardsBefore

                expect(treasuryBalanceDelta).to.be.equal(protocolFee)
                expect(strategistRewardsDelta).to.be.equal(strategistFee)
            })
        })

        describe('when strategist is subscribed and strategy is hot', async () => {
            it('increase strategist rewards and send fees to treasury', async () => {
                const treasuryBalanceBefore = await stablecoin.balanceOf(treasury)
                const strategistRewardsBefore = await strategyManager.getStrategistRewards(account0)

                await strategyManager.setHottestStrategies([0])
                await _invest(account1)

                const { strategistFee, protocolFee } = await getStrategyFeeAmount(amountToInvest)

                const treasuryBalanceDelta = (await stablecoin.balanceOf(treasury)) - treasuryBalanceBefore
                const strategistRewardsDelta = (await strategyManager.getStrategistRewards(account0)) - strategistRewardsBefore

                expect(treasuryBalanceDelta).to.be.equal(protocolFee)
                expect(strategistRewardsDelta).to.be.equal(strategistFee)
            })
        })

        describe('when strategist is not subscribed', () => {
            let strategist: string
            let initialStrategistRewards: bigint

            beforeEach(async () => {
                strategist = await strategyManager.getStrategyCreator(strategyId)
                initialStrategistRewards = await strategyManager
                    .getStrategistRewards(strategist)
            })

            it('subscribed user sends strategist rewards to treasury', async () => {
                const receipt = await (
                    await _invest(
                        account1,
                        await getInvestParams(account1, { strategistSubscribed: false }),
                    )
                ).wait()

                const finalStrategistRewards = await strategyManager
                    .getStrategistRewards(strategist)

                expect(finalStrategistRewards).to.be.equal(initialStrategistRewards)

                const { protocolFee } = await getStrategyFeeAmount(amountToInvest, strategyId, true, false)

                const feeEvent = getEventLog(receipt, 'Fee', StrategyInvestor__factory.createInterface())

                expect(feeEvent?.args).to.deep.equal([
                    await unwrapAddressLike(account1),
                    await unwrapAddressLike(treasury),
                    protocolFee,
                    AbiCoder.defaultAbiCoder().encode(['uint'], [strategyId]),
                ])
            })

            it('unsubscribed user sends strategist rewards to treasury', async () => {
                const receipt = await (
                    await _invest(
                        account2,
                        await getInvestParams(account2, { investorSubscribed: false, strategistSubscribed: false }),
                    )
                ).wait()

                const finalStrategistRewards = await strategyManager
                    .getStrategistRewards(strategist)

                expect(finalStrategistRewards).to.be.equal(initialStrategistRewards)

                const { protocolFee } = await getStrategyFeeAmount(amountToInvest, strategyId, false, false)

                const feeEvent = getEventLog(receipt, 'Fee', StrategyInvestor__factory.createInterface())

                expect(feeEvent?.args).to.deep.equal([
                    await unwrapAddressLike(account2),
                    await unwrapAddressLike(treasury),
                    protocolFee,
                    AbiCoder.defaultAbiCoder().encode(['uint'], [strategyId]),
                ])
            })
        })

        it('invest using native ETH', async () => {
            const investParams = await getInvestNativeParams(account1)
            const amountToInvestInStable = parseToStableAmount(amountToInvest, wethPriced)

            await _investNative(account1, investParams)

            const [
                dcaPosition0,
                dcaPosition1,
                dcaPositionBalance0,
                dcaPositionBalance1,
                amountWithDeductedFees,
                investments,
                { liquidityPositions, vaultPositions },
            ] = await Promise.all([
                dca.getPosition(strategyManager, 0),
                dca.getPosition(strategyManager, 1),
                dca.getPositionBalances(strategyManager, 0),
                dca.getPositionBalances(strategyManager, 1),
                deductFees(amountToInvestInStable),
                strategyManager.getStrategyInvestments(strategyId),
                strategyManager.getPositionInvestments(account1, 0),
            ])

            /////////////////////
            // DCA Position 0 //
            ///////////////////
            expect(dcaPosition0.swaps).to.be.equal(investments.dcaInvestments[0].swaps)
            expect(dcaPosition0.poolId).to.be.equal(investments.dcaInvestments[0].poolId)
            Compare.almostEqualPercentage({
                value: amountWithDeductedFees * investments.dcaInvestments[0].percentage / 100n,
                target: dcaPositionBalance0.inputTokenBalance,
                tolerance: ONE_PERCENT,
            })

            /////////////////////
            // DCA Position 1 //
            ///////////////////
            expect(dcaPosition1.swaps).to.be.equal(investments.dcaInvestments[1].swaps)
            expect(dcaPosition1.poolId).to.be.equal(investments.dcaInvestments[1].poolId)
            Compare.almostEqualPercentage({
                value: amountWithDeductedFees * investments.dcaInvestments[1].percentage / 100n,
                target: dcaPositionBalance1.inputTokenBalance,
                tolerance: ONE_PERCENT,
            })

            ////////////////////
            // VaultPosition //
            //////////////////
            expect(vaultPositions[0].vault).to.be.equal(await vault.getAddress())
            Compare.almostEqualPercentage({
                value: amountWithDeductedFees * investments.vaultInvestments[0].percentage / 100n,
                target: vaultPositions[0].amount,
                tolerance: ONE_PERCENT,
            })

            ////////////////////////
            // LiquidityPosition //
            //////////////////////
            const {
                token0,
                token1,
                fee,
                tickLower,
                tickUpper,
                liquidity,
            } = await positionManagerUniV3
                .positions(liquidityPositions[0].tokenId)

            const { amount0, amount1 } = UniswapV3.getPositionTokenAmounts(
                await UniswapV3Helper.getPoolByFactoryContract(
                    factoryUniV3,
                    token0,
                    token1,
                    fee,
                ),
                liquidity,
                tickLower,
                tickUpper,
            )

            const pricedToken0 = getPricedTokenOrFail(token0)
            const pricedToken1 = getPricedTokenOrFail(token1)

            expect(fee).to.be.equal(investments.liquidityInvestments[0].fee)
            expect(token0).to.be.equal(investments.liquidityInvestments[0].token0)
            expect(token1).to.be.equal(investments.liquidityInvestments[0].token1)

            expect(tickLower).to.be.equal(investParams.liquidityZaps[0].tickLower)
            expect(tickUpper).to.be.equal(investParams.liquidityZaps[0].tickUpper)

            expect(liquidity).to.be.equal(liquidityPositions[0].liquidity)
            expect(await positionManagerUniV3.getAddress()).to.be.equal(liquidityPositions[0].positionManager)

            Compare.almostEqualPercentage({
                value: amountWithDeductedFees * investments.liquidityInvestments[0].percentage / 100n,
                target: BigInt(
                    pricedToken0.price.times(amount0.toString())
                        .plus(pricedToken1.price.times(amount1.toString()))
                        .toFixed(0),
                ),
                tolerance: ONE_PERCENT,
            })
        })
    })

    describe('SIDE-EFFECT', () => {
        it('save position in the array of investments', async () => {
            await _invest(account1)

            const investmentsLength = await strategyManager.getPositionsLength(account1)
            const position = await strategyManager.getPosition(account1, 0)
            const investments = await strategyManager.getPositionInvestments(account1, 0)

            expect(investmentsLength).to.be.equal(1n)
            expect(position.strategyId).to.be.equal(0n)
            expect(investments.dcaPositions[0]).to.be.equal(0n)
            expect(investments.dcaPositions[1]).to.be.equal(1n)
        })

        it('emits PositionCreated event', async () => {
            const tx = await _invest(account1)

            const [
                amountWithDeductedFees,
                positionId,
                investments,
            ] = await Promise.all([
                deductFees(amountToInvest),
                positionManagerUniV3.tokenOfOwnerByIndex(strategyManager, 0),
                strategyManager.getStrategyInvestments(strategyId),
            ])

            const uniV3Position = await positionManagerUniV3.positions(positionId)

            expect(tx)
                .to.emit(strategyManager, 'PositionCreated')
                .withArgs(
                    account1,
                    0,
                    0,
                    stablecoin,
                    amountToInvest,
                    amountWithDeductedFees,
                    [0, 1],
                    [
                        [
                            await vault.getAddress(),
                            amountWithDeductedFees * investments.vaultInvestments[0].percentage / 100n,
                        ],
                    ],
                    [
                        [
                            await positionManagerUniV3.getAddress(),
                            positionId,
                            uniV3Position.liquidity,
                        ],
                    ],
                    [],
                )
        })
    })

    describe('REVERTS', () => {
        it('if swap paths are different than the vault length in strategy', async () => {
            await expectCustomError(
                _invest(
                    account2,
                    {
                        ...await getInvestParams(account2, { investorSubscribed: false }),
                        vaultSwaps: [],
                    },
                ),
                'InvalidParamsLength',
            )
        })

        it('if swap paths are different than the dca length in strategy', async () => {
            await expectCustomError(
                _invest(
                    account2,
                    {
                        ...await getInvestParams(account2, { investorSubscribed: false }),
                        dcaSwaps: [],
                    },
                ),
                'InvalidParamsLength',
            )
        })

        it('if swap paths are different than the liquidity length in strategy', async () => {
            await expectCustomError(
                _invest(
                    account2,
                    {
                        ...await getInvestParams(account2, { investorSubscribed: false }),
                        liquidityZaps: [],
                    },
                ),
                'InvalidParamsLength',
            )
        })

        it('if strategyId do not exist', async () => {
            await expectCustomError(
                _invest(
                    account2,
                    {
                        ...await getInvestParams(account2, { investorSubscribed: false }),
                        strategyId: 99,
                    },
                ),
                'StrategyUnavailable',
            )
        })
    })
})
