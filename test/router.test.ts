import hre from 'hardhat'
import { expect } from 'chai'
import { parseEther, Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { RoutePlanner, UniversalRouterCommand, PathUniswapV3, unwrapAddressLike, Slippage } from '@defihub/shared'

import { Compare } from '@src/Compare'
import { UniswapV3 } from '@src/helpers'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { TestERC20, UniswapPositionManager, UniswapV3Factory, UniversalRouter } from '@src/typechain'
import { ETH_PRICE, ETH_PRICE_BN, ETH_QUOTE, ONE_PERCENT, USD_PRICE_BN, USD_QUOTE } from '@src/constants'

const ONE_ETH = parseEther('1')
const ONE_BILLION_ETH = parseEther('1000000000')

describe('Universal Router', () => {
    let liquidityProvider: Signer
    let swapper: Signer

    // dex
    let factoryUniV3: UniswapV3Factory
    let positionManagerUniV3: UniswapPositionManager
    let universalRouter: UniversalRouter

    // tokens
    let weth: TestERC20
    let stablecoin: TestERC20

    let planner: RoutePlanner

    beforeEach(async () => {
        function fixture() {
            return new ProjectDeployer().deployProjectFixture()
        }

        ({
            factoryUniV3,
            positionManagerUniV3,
            universalRouter,
            weth,
            stablecoin,
        } = await loadFixture(fixture));

        [
            liquidityProvider,
            swapper,
        ] = await hre.ethers.getSigners()

        await UniswapV3.mintAndAddLiquidity(
            factoryUniV3,
            positionManagerUniV3,
            weth,
            stablecoin,
            ONE_BILLION_ETH / ETH_PRICE,
            ONE_BILLION_ETH,
            ETH_PRICE_BN,
            USD_PRICE_BN,
            liquidityProvider,
        )

        planner = new RoutePlanner(await unwrapAddressLike(universalRouter))
    })

    it('swaps', async () => {
        expect(await weth.balanceOf(swapper)).to.be.equal(0)
        expect(await stablecoin.balanceOf(swapper)).to.be.equal(0)

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

        expect(await weth.balanceOf(swapper)).to.be.equal(0)
        Compare.almostEqualPercentage({
            value: await stablecoin.balanceOf(swapper),
            target: ONE_ETH * ETH_PRICE,
            tolerance: ONE_PERCENT,
        })
    })

    it('swaps native', async () => {
        expect(await stablecoin.balanceOf(swapper)).to.be.equal(0)

        planner
            .addCommand(
                UniversalRouterCommand.WRAP_ETH,
                [await unwrapAddressLike(universalRouter), ONE_ETH],
            )
            .addCommand(
                UniversalRouterCommand.V3_SWAP_EXACT_IN,
                [
                    await swapper.getAddress(),
                    ONE_ETH,
                    Slippage.getMinOutput(
                        ONE_ETH,
                        ETH_QUOTE,
                        USD_QUOTE,
                        ONE_PERCENT,
                    ),
                    (await PathUniswapV3.fromAddressLike(
                        weth,
                        [{ token: stablecoin, fee: 3000 }],
                    )).encodedPath(),
                    false,
                ],
            )

        await universalRouter.connect(swapper)['execute(bytes,bytes[])'](
            planner.commands,
            planner.inputs,
            { value: ONE_ETH },
        )

        Compare.almostEqualPercentage({
            value: await stablecoin.balanceOf(swapper),
            target: ONE_ETH * ETH_PRICE,
            tolerance: ONE_PERCENT,
        })
    })
})
