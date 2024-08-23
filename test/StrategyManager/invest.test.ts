import { expect } from 'chai'
import { AbiCoder, ErrorDescription, parseEther, Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    StrategyFundsCollector,
    StrategyManager,
    SubscriptionManager,
    TestERC20,
    TestVault,
    UniswapPositionManager,
    UniswapV3Factory,
    UseFee,
} from '@src/typechain'
import { createStrategyFixture } from './fixtures/create-strategy.fixture'
import { decodeLowLevelCallError, getEventLog, LiquidityHelpers, UniswapV3 as UniswapV3Helper } from '@src/helpers'
import { ERC20Priced, UniswapV3, unwrapAddressLike } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { Fees } from '@src/helpers/Fees'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { Compare } from '@src/Compare'

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
    const SLIPPAGE_BN = new BigNumber(0.01)
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

    // hub contracts
    let strategyFundsCollector: StrategyFundsCollector
    let strategyManager: StrategyManager
    let vault: TestVault
    let dca: DollarCostAverage
    let liquidityManager: UseFee
    let vaultManager: UseFee
    let buyProduct: UseFee

    // external test contracts
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

    async function getInvestParams(investor: Signer, {
        _amount = amountToInvest,
        _strategyId = strategyId,
        _investorSubscribed = true,
        _strategistSubscribed = true,
    }: {
        _amount?: bigint,
        _strategyId?: bigint,
        _investorSubscribed?: boolean,
        _strategistSubscribed?: boolean,
    } = {
        _amount: amountToInvest,
        _strategyId: strategyId,
        _investorSubscribed: true,
        _strategistSubscribed: true,
    }): Promise<StrategyManager.InvestParamsStruct> {
        const deadlineInvestor = _investorSubscribed ? deadline : 0

        const [
            { dcaInvestments, vaultInvestments, liquidityInvestments },
            amountWithDeductedFees,
            investorPermit,
        ] = await Promise.all([
            strategyManager.getStrategyInvestments(_strategyId),
            deductFees(_amount, _strategyId, _investorSubscribed, _strategistSubscribed),
            subscriptionSignature
                .signSubscriptionPermit(await investor.getAddress(), deadlineInvestor),
        ])

        const liquidityZaps = await Promise.all(liquidityInvestments.map(
            investment => LiquidityHelpers.getLiquidityZap(
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
            strategyId: _strategyId,
            inputToken: stablecoin,
            inputAmount: _amount,
            inputTokenSwap: '0x',
            dcaSwaps: dcaInvestments.map(_ => '0x'),
            vaultSwaps: vaultInvestments.map(_ => '0x'),
            liquidityZaps,
            buySwaps: [], // TODO
            investorPermit,
            strategistPermit: _strategistSubscribed ? permitAccount0 : expiredPermitAccount0,
        }
    }

    async function _invest(
        investor: Signer,
        investParams?: StrategyManager.InvestParamsStruct,
    ) {
        return strategyManager
            .connect(investor)
            .invest(investParams ? investParams : await getInvestParams(investor))
    }

    beforeEach(async () => {
        ({
            // accounts
            account0,
            account1,
            account2,
            treasury,

            // tokens
            stablecoin,
            stablecoinPriced,

            // hub contracts
            strategyFundsCollector,
            strategyManager,
            dca,
            vault,
            liquidityManager,
            vaultManager,
            buyProduct,

            // external test contracts
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
                    tolerance: new BigNumber(0.01),
                })
            })
        })

        describe('when user is not subscribed', () => {
            it('create investment position in dca, vaults and liquidity', async () => {
                const investParams = await getInvestParams(account2, { _investorSubscribed: false })

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
                    tolerance: new BigNumber(0.01),
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
                        await getInvestParams(account1, { _strategistSubscribed: false }),
                    )
                ).wait()

                const finalStrategistRewards = await strategyManager
                    .getStrategistRewards(strategist)

                expect(finalStrategistRewards).to.be.equal(initialStrategistRewards)

                const { protocolFee } = await getStrategyFeeAmount(amountToInvest, strategyId, true, false)

                const feeEvent = getEventLog(receipt, 'Fee', strategyFundsCollector.interface)

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
                        await getInvestParams(account2, { _investorSubscribed: false, _strategistSubscribed: false }),
                    )
                ).wait()

                const finalStrategistRewards = await strategyManager
                    .getStrategistRewards(strategist)

                expect(finalStrategistRewards).to.be.equal(initialStrategistRewards)

                const { protocolFee } = await getStrategyFeeAmount(amountToInvest, strategyId, false, false)

                const feeEvent = getEventLog(receipt, 'Fee', strategyFundsCollector.interface)

                expect(feeEvent?.args).to.deep.equal([
                    await unwrapAddressLike(account2),
                    await unwrapAddressLike(treasury),
                    protocolFee,
                    AbiCoder.defaultAbiCoder().encode(['uint'], [strategyId]),
                ])
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
            try {
                await _invest(
                    account2,
                    {
                        ...await getInvestParams(account2, { _investorSubscribed: false }),
                        vaultSwaps: [],
                    },
                )
            }
            catch (e) {
                const decodedError = decodeLowLevelCallError(e)

                if (!(decodedError instanceof ErrorDescription))
                    throw new Error('Error decoding custom error')

                expect(decodedError.name).to.be.equal('InvalidParamsLength')
            }
        })

        it('if swap paths are different than the dca length in strategy', async () => {
            try {
                await _invest(
                    account2,
                    {
                        ...await getInvestParams(account2, { _investorSubscribed: false }),
                        dcaSwaps: [],
                    },
                )
            }
            catch (e) {
                const decodedError = decodeLowLevelCallError(e)

                if (!(decodedError instanceof ErrorDescription))
                    throw new Error('Error decoding custom error')

                expect(decodedError.name).to.be.equal('InvalidParamsLength')
            }
        })

        it('if swap paths are different than the liquidity length in strategy', async () => {
            try {
                await _invest(
                    account2,
                    {
                        ...await getInvestParams(account2, { _investorSubscribed: false }),
                        liquidityZaps: [],
                    },
                )
            }
            catch (e) {
                const decodedError = decodeLowLevelCallError(e)

                if (!(decodedError instanceof ErrorDescription))
                    throw new Error('Error decoding custom error')

                expect(decodedError.name).to.be.equal('InvalidParamsLength')
            }
        })

        it('if strategyId do not exist', async () => {
            const tx = _invest(
                account2,
                {
                    ...await getInvestParams(account2, { _investorSubscribed: false }),
                    strategyId: 99,
                },
            )

            await expect(tx).to.revertedWithCustomError(strategyManager, 'StrategyUnavailable')
        })
    })
})
