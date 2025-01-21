import { TestERC20, UniswapPositionManager, UniswapV3Factory, UniversalRouter } from '@src/typechain'
import { parseEther, Signer } from 'ethers'
import hre from 'hardhat'
import { UniswapV3 } from '@src/helpers'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { ProjectDeployer } from '@src/ProjectDeployer'
import { ETH_PRICE, ETH_PRICE_BN, USD_PRICE_BN } from '@src/constants'
import { CommandType, RoutePlanner } from '@src/helpers/RoutePlanner'
import { PathUniswapV3 } from '@defihub/shared'
import { expect } from 'chai'
import { Compare } from '@src/Compare'
import { BigNumber } from '@ryze-blockchain/ethereum'

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

    beforeEach(async () => {
        function  fixture() {
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
    })

    it('swaps', async () => {
        const planner = new RoutePlanner()

        expect(await weth.balanceOf(swapper)).to.be.equal(0)
        expect(await stablecoin.balanceOf(swapper)).to.be.equal(0)

        planner.addCommand(
            CommandType.V3_SWAP_EXACT_IN,
            [
                await swapper.getAddress(),
                ONE_ETH,
                ONE_ETH - parseEther('0.01'),
                await new PathUniswapV3(
                    weth,
                    [{ token: stablecoin, fee: 3000 }],
                ).encodedPath(),
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
            tolerance: new BigNumber(0.01),
        })
    })
})
