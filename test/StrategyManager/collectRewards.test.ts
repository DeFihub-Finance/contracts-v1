import hre from 'hardhat'
import { expect } from 'chai'
import { parseEther, Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { PathUniswapV3, RoutePlanner, UniversalRouterCommand, unwrapAddressLike } from '@defihub/shared'
import { StrategyManager__v4, TestERC20, UniversalRouter } from '@src/typechain'
import { runStrategy } from './fixtures/run-strategy.fixture'
import { getAccountBalanceMap, getAccountRewardsMap } from '@src/helpers'

/*
    => when collectRewards method is called
        => if user does not have any rewards to collect, then it does nothing
        => if user has rewards to collect
            => if token is stable
                => then collect rewards from all sources
                => then transfer rewards to msg.sender
                => then emit CollectedRewards event
            => if token is not stable
                => then collect rewards ONLY from liquidity fees
                => then transfer rewards to msg.sender
                => then emit CollectedRewards event

    => when collectManyRewards method is called
        => if tokens list is empty, then it does nothing
        => if user does not have any rewards to collect, then it does nothing
        => if user has rewards to collect
            => then collect rewards from all sources
            => then transfer rewards to msg.sender
            => then emit CollectedRewards event to all tokens
*/
describe('StrategyManager#collectRewards', () => {
    const ONE_ETH = parseEther('1')

    let strategyManager: StrategyManager__v4
    let account0: Signer
    let account1: Signer

    let weth: TestERC20
    let stablecoin: TestERC20

    let liquidityPositionId: bigint
    let universalRouter: UniversalRouter

    async function swapWethForStable() {
        const [swapper] = await hre.ethers.getSigners()
        const planner = new RoutePlanner(await unwrapAddressLike(universalRouter))

        planner.addCommand(
            UniversalRouterCommand.V3_SWAP_EXACT_IN,
            [
                await swapper.getAddress(),
                ONE_ETH,
                ONE_ETH - parseEther('0.01'),
                (await PathUniswapV3.fromAddressLike(
                    weth,
                    [{ token: stablecoin, fee: 3000 }],
                )).encodedPath(),
                false,
            ],
        )

        await weth.connect(swapper).mint(swapper, ONE_ETH)
        await weth.connect(swapper).transfer(universalRouter, ONE_ETH)
        await universalRouter.connect(swapper)['execute(bytes,bytes[])'](
            planner.commands,
            planner.inputs,
        )
    }

    beforeEach(async () => {
        ({
            strategyManager,
            account0,
            account1,
            weth,
            stablecoin,
            liquidityPositionId,
            universalRouter,
        } = await loadFixture(runStrategy))
    })

    describe('when collectRewards method is called', () => {
        it('if user does not have any rewards to collect, then it does nothing', async () => {
            expect(await strategyManager.getRewards(account1, weth)).to.equal(0)

            await expect(strategyManager.connect(account1).collectRewards(weth))
                .to.not.emit(strategyManager, 'CollectedRewards')
        })

        describe('if user has rewards to collect', () => {
            describe('if token is stable', () => {
                it('then collect rewards from all sources', async () => {
                    const toCollect = await strategyManager.getRewards(account0, stablecoin)
                    const strategistRewards = await strategyManager.getStrategistRewards(account0)

                    expect(toCollect).to.greaterThan(0)
                    expect(strategistRewards).to.be.greaterThan(0)

                    await strategyManager.connect(account0).collectRewards(stablecoin)

                    expect(await strategyManager.getStrategistRewards(account0)).to.equal(0)
                    expect(await strategyManager.getRewards(account0, stablecoin)).to.equal(0)
                })

                it('then transfer rewards to msg.sender', async () => {
                    const balanceBefore = await stablecoin.balanceOf(account0)
                    const toCollect = await strategyManager.getRewards(account0, stablecoin)

                    await strategyManager.connect(account0).collectRewards(stablecoin)

                    const balanceDelta = (await stablecoin.balanceOf(account0)) - balanceBefore

                    expect(toCollect).to.be.greaterThan(0)
                    expect(balanceDelta).to.equal(toCollect)
                })

                it('then emit CollectedRewards event', async () => {
                    const toCollect = await strategyManager.getRewards(account0, stablecoin)

                    await expect(strategyManager.connect(account0).collectRewards(stablecoin))
                        .to.emit(strategyManager, 'CollectedRewards')
                        .withArgs(account0, stablecoin, toCollect)
                })
            })

            describe('if token is not stable', () => {
                beforeEach(async () => {
                    // Make a swap to generate liquidity fees
                    await swapWethForStable()

                    // Collect position that has liquidity fees to generate rewards
                    await strategyManager.connect(account1).collectPosition(liquidityPositionId)
                })

                it('then collect rewards ONLY from liquidity fees', async () => {
                    const wethToCollect = await strategyManager.getRewards(account0, weth)
                    const stableToCollect = await strategyManager.getRewards(account0, stablecoin)

                    expect(wethToCollect).to.be.greaterThan(0)
                    expect(stableToCollect).to.be.greaterThan(0)

                    await strategyManager.connect(account0).collectRewards(weth)

                    expect(await strategyManager.getRewards(account0, weth)).to.equal(0)
                    expect(await strategyManager.getRewards(account0, stablecoin)).to.equal(stableToCollect)
                })

                it('then transfer rewards to msg.sender', async () => {
                    const balanceBefore = await weth.balanceOf(account0)
                    const toCollect = await strategyManager.getRewards(account0, weth)

                    await strategyManager.connect(account0).collectRewards(weth)

                    const balanceDelta = (await weth.balanceOf(account0)) - balanceBefore

                    expect(toCollect).to.be.greaterThan(0)
                    expect(balanceDelta).to.equal(toCollect)
                })

                it('then emit CollectedRewards event', async () => {
                    const toCollect = await strategyManager.getRewards(account0, weth)

                    await expect(strategyManager.connect(account0).collectRewards(weth))
                        .to.emit(strategyManager, 'CollectedRewards')
                        .withArgs(account0, weth, toCollect)
                })
            })
        })
    })

    describe('when collectManyRewards method is called', () => {
        it('if tokens list is empty, then it does nothing', async () => {
            await expect(strategyManager.connect(account1).collectManyRewards([]))
                .to.not.emit(strategyManager, 'CollectedRewards')
        })

        it('if user does not have any rewards to collect, then it does nothing', async () => {
            expect(await strategyManager.getRewards(account1, weth)).to.equal(0)

            await expect(strategyManager.connect(account1).collectManyRewards([weth]))
                .to.not.emit(strategyManager, 'CollectedRewards')
        })

        describe('if user has rewards to collect', () => {
            beforeEach(async () => {
                // Make a swap to generate liquidity fees
                await swapWethForStable()

                // Collect position that has liquidity fees to generate rewards
                await strategyManager.connect(account1).collectPosition(liquidityPositionId)
            })

            it('then collect rewards from all sources', async () => {
                const [
                    wethToCollect,
                    stableToCollect,
                ] = await Promise.all([
                    strategyManager.getRewards(account0, weth),
                    strategyManager.getRewards(account0, stablecoin),
                ])

                expect(wethToCollect).to.greaterThan(0)
                expect(stableToCollect).to.greaterThan(0)

                await strategyManager.connect(account0).collectManyRewards([weth, stablecoin])

                expect(await strategyManager.getStrategistRewards(account0)).to.equal(0)

                expect(await strategyManager.getRewards(account0, weth)).to.equal(0)
                expect(await strategyManager.getRewards(account0, stablecoin)).to.equal(0)
            })

            it('then transfer rewards to msg.sender', async () => {
                const tokensToCollect = new Set([
                    await unwrapAddressLike(weth),
                    await unwrapAddressLike(stablecoin),
                ])

                const [
                    rewardBalancesBefore,
                    userTokenBalancesBefore,
                ] = await Promise.all([
                    getAccountRewardsMap(account0, tokensToCollect, strategyManager),
                    getAccountBalanceMap(tokensToCollect, account0),
                ])

                for (const token of tokensToCollect)
                    expect(rewardBalancesBefore[token]).to.greaterThan(0)

                await strategyManager.connect(account0).collectManyRewards([weth, stablecoin])

                const [
                    rewardBalancesAfter,
                    userTokenBalancesAfter,
                ] = await Promise.all([
                    getAccountRewardsMap(account0, tokensToCollect, strategyManager),
                    getAccountBalanceMap(tokensToCollect, account0),
                ])

                for (const token of tokensToCollect) {
                    expect(userTokenBalancesAfter[token]).to.equal(
                        userTokenBalancesBefore[token] + rewardBalancesBefore[token],
                    )

                    expect(rewardBalancesAfter[token]).to.equal(0)
                }
            })

            it('then emit CollectedRewards event to all tokens', async () => {
                const wethToCollect = await strategyManager.getRewards(account0, weth)
                const stableToCollect = await strategyManager.getRewards(account0, stablecoin)

                await expect(strategyManager.connect(account0).collectManyRewards([weth, stablecoin]))
                    .to.emit(strategyManager, 'CollectedRewards')
                    .withArgs(account0, weth, wethToCollect)
                    .and
                    .to.emit(strategyManager, 'CollectedRewards')
                    .withArgs(account0, stablecoin, stableToCollect)
            })
        })
    })
})

