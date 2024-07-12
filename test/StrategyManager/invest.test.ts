import { expect } from 'chai'
import { AbiCoder, BigNumberish, ErrorDescription, parseEther, Signer, ZeroHash } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import {
    DollarCostAverage,
    StrategyManager,
    TestERC20,
    TestVault,
    UniswapPositionManager,
    UniswapV3Factory,
    UseFee,
} from '@src/typechain'
import { InvestLib } from '@src/typechain/artifacts/contracts/StrategyManager'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { NetworkService } from '@src/NetworkService'
import { ContractFees } from '@src/ContractFees'
import { createStrategyFixture } from './fixtures/create-strategy.fixture'
import {
    decodeLowLevelCallError,
    UniswapV2ZapHelper,
    UniswapV3 as UniswapV3Helper,
    UniswapV3ZapHelper,
} from '@src/helpers'
import { ERC20Priced, Slippage, UniswapV3 } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { Fees } from '@src/helpers/Fees'

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

    let amountWithDeductedFees: bigint

    // accounts
    let account0: Signer
    let account1: Signer
    let account2: Signer
    let treasury: Signer

    // prices
    let USD_PRICE_BN: BigNumber

    // tokens
    let stablecoin: TestERC20
    let stablecoinPriced: ERC20Priced
    let wethPriced: ERC20Priced

    // hub contracts
    let vault: TestVault
    let dca: DollarCostAverage
    let strategyManagerAddress: string
    let strategyManager: StrategyManager
    let liquidityManager: UseFee
    let vaultManager: UseFee
    let exchangeManager: UseFee

    // external test contracts
    let positionManagerUniV3: UniswapPositionManager
    let factoryUniV3: UniswapV3Factory

    // global data
    let deadline: number
    let subscriptionSignature: SubscriptionSignature
    let dcaStrategyPositions: InvestLib.DcaInvestmentStruct[]
    let vaultStrategyPosition: InvestLib.VaultInvestmentStruct[]
    let investments: {
        dcaInvestments: InvestLib.DcaInvestmentStructOutput[],
        vaultInvestments: InvestLib.VaultInvestmentStructOutput[],
        liquidityInvestments: InvestLib.LiquidityInvestmentStructOutput[]
        tokenInvestments: InvestLib.TokenInvestmentStructOutput[]
    }

    let strategyId = 0n
    let tokenMap: Map<string, ERC20Priced>

    const vaultSwaps = ['0x']
    const dcaSwaps = ['0x', '0x']

    function deductFees(
        amount: bigint,
        _strategyId: bigint = strategyId,
        isSubscribed = true,
    ) {
        return Fees.deductStrategyFee(
            amount,
            strategyManager,
            _strategyId,
            isSubscribed,
            dca,
            vaultManager,
            liquidityManager,
            exchangeManager,
        )
    }

    function getMinOutput(
        amount: bigint,
        outputToken: ERC20Priced,
    ) {
        if (outputToken.address === stablecoinPriced.address)
            return Slippage.deductSlippage(amount, SLIPPAGE_BN)

        return Slippage.getMinOutput(
            amount,
            stablecoinPriced,
            outputToken,
            SLIPPAGE_BN.times(2),
        )
    }

    async function getEncodedSwap(
        amount: bigint,
        outputToken: ERC20Priced,
        protocol: 'uniswapV2' | 'uniswapV3' = 'uniswapV2',
    ) {
        if (!amount || outputToken.address === stablecoinPriced.address)
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

    async function getLiquidityZaps(
        amount: bigint,
        liquidityInvestments: InvestLib.LiquidityInvestmentStructOutput[],
    ): Promise<InvestLib.LiquidityInvestZapParamsStruct[]> {
        return Promise.all(liquidityInvestments.map(async investment => {
            const [token0, token1] = [
                tokenMap.get(investment.token0),
                tokenMap.get(investment.token1),
            ]

            if (!token0 || !token1)
                throw new Error('Unable to get ERC20Priced token(s) from Map')

            const pool = await UniswapV3Helper.getPoolByFactoryContract(
                factoryUniV3,
                token0.address,
                token1.address,
                investment.fee,
            )

            const {
                swapAmountToken0,
                swapAmountToken1,
                tickLower,
                tickUpper,
            } = UniswapV3.getMintPositionInfo(
                new BigNumber((amount * investment.percentage / 100n).toString()),
                pool,
                token0.price,
                token1.price,
                Number(investment.lowerPricePercentage),
                Number(investment.upperPricePercentage),
            )

            return {
                amount0Min: getMinOutput(swapAmountToken0, token0),
                amount1Min: getMinOutput(swapAmountToken1, token1),
                swapAmountToken0,
                swapAmountToken1,
                swapToken0: await getEncodedSwap(swapAmountToken0, token0, 'uniswapV3'),
                swapToken1: await getEncodedSwap(swapAmountToken1, token1, 'uniswapV3'),
                tickLower,
                tickUpper,
            }
        }))
    }

    async function createStrategy({
        dcaInvestments,
        vaultInvestments,
        liquidityInvestments,
        tokenInvestments,
    }: {
        dcaInvestments: InvestLib.DcaInvestmentStruct[]
        vaultInvestments: InvestLib.VaultInvestmentStruct[]
        liquidityInvestments: InvestLib.LiquidityInvestmentStruct[]
        tokenInvestments: InvestLib.TokenInvestmentStruct[]
    }) {
        const [
            strategyId,
            strategiestAddress,
            blockTimestamp,
        ] = await Promise.all([
            strategyManager.getStrategiesLength(),
            account0.getAddress(),
            NetworkService.getBlockTimestamp(),
        ])

        await strategyManager.connect(account0).createStrategy({
            dcaInvestments,
            vaultInvestments,
            liquidityInvestments,
            tokenInvestments,
            permit: await subscriptionSignature.signSubscriptionPermit(
                strategiestAddress,
                blockTimestamp + 10_000,
            ),
            metadataHash: ZeroHash, // TODO use encoded text
        })

        return strategyId
    }

    async function _invest(
        amount: bigint,
        strategyId: bigint,
        investor: Signer,
    ) {
        const {
            dcaInvestments,
            vaultInvestments,
            liquidityInvestments,
        } = await strategyManager.getStrategyInvestments(strategyId)
        const liquidityZaps = await getLiquidityZaps(amount, liquidityInvestments)

        return strategyManager.connect(investor).invest({
            strategyId,
            inputToken: stablecoin,
            inputAmount: amountToInvest,
            inputTokenSwap: '0x',
            dcaSwaps: dcaInvestments.map(_ => '0x'),
            vaultSwaps: vaultInvestments.map(_ => '0x'),
            liquidityZaps,
            tokenSwaps: [], // TODO
            investorPermit: await subscriptionSignature
                .signSubscriptionPermit(await investor.getAddress(), deadline),
            strategistPermit: await subscriptionSignature
                .signSubscriptionPermit(await account0.getAddress(), deadline),
        })
    }

    async function invest(account: Signer, {
        _strategyId = strategyId,
        _dcaSwaps = dcaSwaps,
        _vaultSwaps = vaultSwaps,
        _deadlineInvestor = deadline,
        _deadlineStrategist = deadline,
    }: {
        _strategyId?: BigNumberish
        _dcaSwaps?: string[]
        _vaultSwaps?: string[]
        _deadlineInvestor?: number
        _deadlineStrategist?: number
    } = {
        _strategyId: strategyId,
        _dcaSwaps: dcaSwaps,
        _vaultSwaps: vaultSwaps,
        _deadlineInvestor: deadline,
        _deadlineStrategist: deadline,
    }) {
        return strategyManager.connect(account).invest({
            strategyId: _strategyId,
            inputToken: stablecoin,
            inputAmount: amountToInvest,
            inputTokenSwap: '0x',
            dcaSwaps: _dcaSwaps,
            vaultSwaps: _vaultSwaps,
            tokenSwaps: [],
            liquidityZaps: [],
            investorPermit: await subscriptionSignature
                .signSubscriptionPermit(await account.getAddress(), _deadlineInvestor),
            strategistPermit: await subscriptionSignature
                .signSubscriptionPermit(await account0.getAddress(), _deadlineStrategist),
        })
    }

    beforeEach(async () => {
        ({
            // accounts
            account0,
            account1,
            account2,
            treasury,

            // prices
            USD_PRICE_BN,

            // tokens
            stablecoin,
            stablecoinPriced,
            wethPriced,

            // hub contracts
            dca,
            vault,
            strategyManager,
            strategyManagerAddress,
            liquidityManager,
            vaultManager,
            exchangeManager,

            // external test contracts
            positionManagerUniV3,
            factoryUniV3,

            // global data
            dcaStrategyPositions,
            vaultStrategyPosition,
            subscriptionSignature,

            tokenMap,
        } = await loadFixture(createStrategyFixture))

        const { token0, token1 } = UniswapV3.sortTokens(stablecoinPriced, wethPriced)

        // Default strategy with all investments
        strategyId = await createStrategy({
            dcaInvestments: [
                { poolId: 0, swaps: 10, percentage: 25 },
                { poolId: 1, swaps: 10, percentage: 25 },
            ],
            vaultInvestments: [
                {
                    vault: await vault.getAddress(),
                    percentage: 25,
                },
            ],
            liquidityInvestments: [
                {
                    positionManager: positionManagerUniV3,
                    token0: token0.address,
                    token1: token1.address,
                    fee: 3000,
                    lowerPricePercentage: 10,
                    upperPricePercentage: 10,
                    percentage: 25,
                },
            ],
            tokenInvestments: [],
        })

        ;[
            amountWithDeductedFees,
            investments,
            deadline,
        ] = await Promise.all([
            deductFees(amountToInvest),
            strategyManager.getStrategyInvestments(strategyId),
            NetworkService.getBlockTimestamp().then(val => val + 10_000),
        ])
    })

    describe('EFFECTS', () => {
        describe('when user is subscribed', () => {
            it.only('create investment position in dca, vaults and liquidity', async () => {
                await _invest(amountWithDeductedFees, strategyId, account1)

                const [
                    dcaPosition0,
                    dcaPosition1,
                    dcaPositionBalance0,
                    dcaPositionBalance1,
                ] = await Promise.all([
                    dca.getPosition(strategyManagerAddress, 0),
                    dca.getPosition(strategyManagerAddress, 1),
                    dca.getPositionBalances(strategyManagerAddress, 0),
                    dca.getPositionBalances(strategyManagerAddress, 1),
                ])

                /////////////////////
                // DCA Position 0 //
                ///////////////////
                const expectedDcaPositionBalance0 = await Fees.deductProductFee(
                    amountToInvest * investments.dcaInvestments[0].percentage / 100n,
                    true,
                    dca,
                )

                expect(dcaPosition0.swaps).to.be.equal(investments.dcaInvestments[0].swaps)
                expect(dcaPosition0.poolId).to.be.equal(investments.dcaInvestments[0].poolId)
                expect(dcaPositionBalance0.inputTokenBalance).to.be.equal(expectedDcaPositionBalance0)

                /////////////////////
                // DCA Position 1 //
                ///////////////////
                const expectedDcaPositionBalance1 = await Fees.deductProductFee(
                    amountToInvest * investments.dcaInvestments[1].percentage / 100n,
                    true,
                    dca,
                )

                expect(dcaPosition1.swaps).to.be.equal(investments.dcaInvestments[1].swaps)
                expect(dcaPosition1.poolId).to.be.equal(investments.dcaInvestments[1].poolId)
                expect(dcaPositionBalance1.inputTokenBalance).to.be.equal(expectedDcaPositionBalance1)

                ////////////////////
                // VaultPosition //
                //////////////////
                const expectVaultPositionBalance = await Fees.deductProductFee(
                    amountToInvest * BigInt(investments.vaultInvestments[0].percentage) / 100n,
                    true,
                    vaultManager,
                )

                expect(await vault.balanceOf(strategyManagerAddress)).to.be.equal(expectVaultPositionBalance)
            })
        })

        describe('when user is not subscribed', () => {
            it('create investment position in dca and vaults', async () => {
                await invest(account2, { _deadlineInvestor: 0 })

                const [
                    dcaPosition0,
                    dcaPosition1,
                    dcaPositionBalance0,
                    dcaPositionBalance1,
                ] = await Promise.all([
                    dca.getPosition(strategyManagerAddress, 0),
                    dca.getPosition(strategyManagerAddress, 1),
                    dca.getPositionBalances(strategyManagerAddress, 0),
                    dca.getPositionBalances(strategyManagerAddress, 1),
                ])

                /////////////////////
                // DCA Position 0 //
                ///////////////////
                const baseAmountToDCAPosition0 = amountToInvest * BigInt(dcaStrategyPositions[0].percentage) / 100n
                const expectedDcaPositionBalance0 = ContractFees.discountNonSubscriberFee(baseAmountToDCAPosition0)

                expect(dcaPosition0.swaps).to.be.equal(investments.dcaInvestments[0].swaps)
                expect(dcaPosition0.poolId).to.be.equal(investments.dcaInvestments[0].poolId)
                expect(dcaPositionBalance0.inputTokenBalance).to.be.equal(expectedDcaPositionBalance0)

                /////////////////////
                // DCA Position 1 //
                ///////////////////
                const baseAmountToDCAPosition1 = amountToInvest * BigInt(dcaStrategyPositions[1].percentage) / 100n
                const expectedDcaPositionBalance1 = ContractFees.discountNonSubscriberFee(baseAmountToDCAPosition1)

                expect(dcaPosition1.swaps).to.be.equal(investments.dcaInvestments[1].swaps)
                expect(dcaPosition1.poolId).to.be.equal(investments.dcaInvestments[1].poolId)
                expect(dcaPositionBalance1.inputTokenBalance).to.be.equal(expectedDcaPositionBalance1)

                ////////////////////
                // VaultPosition //
                //////////////////
                const expectVaultPositionBalance = ContractFees.discountNonSubscriberFee(
                    amountToInvest * BigInt(vaultStrategyPosition[0].percentage) / 100n,
                )

                expect(await vault.balanceOf(strategyManagerAddress)).to.be.equal(expectVaultPositionBalance)
            })
        })

        describe('when strategist is subscribed and strategy is not hot', async () => {
            it('increase strategist rewards', async () => {
                const strategistAddress = await account0.getAddress()
                const baseFee = ContractFees.getBaseFee(amountToInvest)
                const strategistFee = ContractFees.getStrategistFee(baseFee)
                const strategistRewardsBefore = await strategyManager.getStrategistRewards(strategistAddress)

                await invest(account1)

                const strategistRewardsDelta = (await strategyManager.getStrategistRewards(strategistAddress)) - strategistRewardsBefore

                expect(strategistRewardsDelta).to.be.equal(strategistFee)
            })

            it('send fees to treasury', async () => {
                const treasuryBalanceBefore = await stablecoin.balanceOf(treasury)
                const baseFee = ContractFees.getBaseFee(amountToInvest)
                const strategistFee = ContractFees.getStrategistFee(baseFee)

                await invest(account1)

                const treasuryBalanceDelta = (await stablecoin.balanceOf(treasury)) - treasuryBalanceBefore

                expect(treasuryBalanceDelta).to.be.equal(baseFee - strategistFee)
            })
        })

        describe('when strategist is subscribed and strategy is hot', async () => {
            it('increase strategist rewards', async () => {
                const strategistAddress = await account0.getAddress()
                const strategistRewardsBefore = await strategyManager.getStrategistRewards(strategistAddress)

                const baseFee = ContractFees.getBaseFee(amountToInvest)
                const strategistFee = baseFee * 30n / 100n

                await strategyManager.setHottestStrategies([0])
                await invest(account2)

                const strategistRewardsDelta = (await strategyManager.getStrategistRewards(strategistAddress)) - strategistRewardsBefore

                expect(strategistRewardsDelta).to.be.equal(strategistFee)
            })

            it('send fees to treasury', async () => {
                const treasuryBalanceBefore = await stablecoin.balanceOf(treasury)

                const baseFee = ContractFees.getBaseFee(amountToInvest)
                const strategistFee = baseFee * 30n / 100n

                await strategyManager.setHottestStrategies([0])
                await invest(account1)

                const treasuryBalanceDelta = (await stablecoin.balanceOf(treasury)) - treasuryBalanceBefore

                expect(treasuryBalanceDelta).to.be.equal(baseFee - strategistFee)
            })
        })

        describe('when strategist is not subscribed', () => {
            let strategist: string
            let investor: string
            let initialStrategistRewards: bigint

            beforeEach(async () => {
                strategist = await strategyManager.getStrategyCreator(strategyId)
                investor = await account2.getAddress()
                initialStrategistRewards = await strategyManager
                    .getStrategistRewards(strategist)
            })

            it('subscribed user sends strategist rewards to treasury', async () => {
                const tx = await invest(account2, { _deadlineStrategist: 0 })

                const finalStrategistRewards = await strategyManager
                    .getStrategistRewards(strategist)

                expect(finalStrategistRewards).to.be.equal(initialStrategistRewards)

                await expect(tx).to.emit(strategyManager, 'Fee').withArgs(
                    investor,
                    treasury,
                    ContractFees.getBaseFee(amountToInvest),
                    AbiCoder.defaultAbiCoder().encode(['uint'], [strategyId]),
                )
            })

            it('unsubscribed user sends strategist rewards to treasury', async () => {
                const tx = await invest(account2, { _deadlineInvestor: 0, _deadlineStrategist: 0 })

                const finalStrategistRewards = await strategyManager
                    .getStrategistRewards(strategist)

                expect(finalStrategistRewards).to.be.equal(initialStrategistRewards)

                await expect(tx).to.emit(strategyManager, 'Fee').withArgs(
                    investor,
                    treasury,
                    ContractFees.getNonSubscriberFee(amountToInvest),
                    AbiCoder.defaultAbiCoder().encode(['uint'], [strategyId]),
                )
            })
        })
    })

    describe('SIDE-EFFECT', () => {
        it('save position in the array of investments', async () => {
            const account1Address = await account1.getAddress()

            await invest(account1)

            const investmentsLength = await strategyManager.getPositionsLength(account1Address)
            const position = await strategyManager.getPosition(account1Address, 0)
            const investments = await strategyManager.getPositionInvestments(account1Address, 0)

            expect(investmentsLength).to.be.equal(1n)
            expect(position.strategyId).to.be.equal(0n)
            expect(investments.dcaPositions[0]).to.be.equal(0n)
            expect(investments.dcaPositions[1]).to.be.equal(1n)
        })

        it('emits PositionCreated event', async () => {
            const account1Address = await account1.getAddress()
            const tx = invest(account1)

            await expect(tx)
                .to.emit(strategyManager, 'PositionCreated')
                .withArgs(
                    account1Address,
                    0,
                    0,
                    stablecoin,
                    amountToInvest,
                    ContractFees.discountBaseFee(amountToInvest),
                    [0, 1],
                    [
                        [
                            await vault.getAddress(),
                            ContractFees.discountBaseFee(
                                amountToInvest * BigInt(vaultStrategyPosition[0].percentage) / 100n,
                            ),
                        ],
                    ],
                    [],
                    [],
                )
        })
    })

    describe('REVERTS', () => {
        it('if swap paths are different than the vault length in strategy', async () => {
            try {
                await invest(account2, { _vaultSwaps: [] })
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
                await invest(account2, { _dcaSwaps: [] })
            }
            catch (e) {
                const decodedError = decodeLowLevelCallError(e)

                if (!(decodedError instanceof ErrorDescription))
                    throw new Error('Error decoding custom error')

                expect(decodedError.name).to.be.equal('InvalidParamsLength')
            }
        })

        it('if strategyId do not exist', async () => {
            const tx = invest(account2, { _strategyId: 99 })

            await expect(tx).to.revertedWithCustomError(strategyManager, 'StrategyUnavailable')
        })
    })
})
