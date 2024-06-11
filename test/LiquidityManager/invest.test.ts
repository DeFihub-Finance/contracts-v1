import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { LiquidityManagerFixture } from './liquidity-manager.fixture'
import { LiquidityManager, TestERC20 } from '@src/typechain'

describe.only('LiquidityManager#invest', () => {
    // tokens
    let stablecoin: TestERC20
    let weth: TestERC20
    let wbtc: TestERC20

    // hub contracts
    let liquidityManager: LiquidityManager

    beforeEach(async () => {
        const {
            stablecoin,
            weth,
            wbtc,
            liquidityManager,
        } = await loadFixture(LiquidityManagerFixture)
    })

    it('should add liquidity', async () => {

    })
})
