import { Signer } from 'ethers'
import {
    DollarCostAverage,
    UniswapV3Factory,
    IBeefyVaultV7__factory,
    NonFungiblePositionManager__factory,
    TestERC20__factory,
    StrategyManager__v4,
} from '@src/typechain'
import { ethers } from 'hardhat'
import { LiquidityHelpers } from '@src/helpers/liquidity'

export const StrategyBalanceModes = {
    ALL: 'all',
    REWARDS: 'rewards',
} as const

export type StrategyBalanceMode = typeof StrategyBalanceModes[keyof typeof StrategyBalanceModes]

export async function getAccountBalanceMap(
    tokens: Set<string>,
    account: Signer,
): Promise<Record<string, bigint>> {
    const tokenBalanceMap: Record<string, bigint> = {}

    await Promise.all(
        Array.from(tokens).map(async token => {
            tokenBalanceMap[token] = await TestERC20__factory
                .connect(token, ethers.provider)
                .balanceOf(account)
        }),
    )

    return tokenBalanceMap
}

export async function getStrategyBalanceMap(
    strategyManager: StrategyManager__v4,
    dca: DollarCostAverage,
    uniswapFactoryV3: UniswapV3Factory,
    account: Signer,
    strategyId: bigint,
    strategyPositionId: bigint,
    mode: StrategyBalanceMode,
) {
    const positionTokenBalances: Record<string, bigint> = {}

    function addOrCreateBalance(token: string, balance: bigint) {
        if (positionTokenBalances[token])
            positionTokenBalances[token] = balance + positionTokenBalances[token]
        else
            positionTokenBalances[token] = balance
    }

    const {
        dcaPositions,
        vaultPositions,
        liquidityPositions,
    } = await strategyManager.getPositionInvestments(
        account,
        strategyPositionId,
    )

    for (const positionId of dcaPositions) {
        const [
            { inputTokenBalance, outputTokenBalance },
            { poolId },
        ] = await Promise.all([
            dca.getPositionBalances(strategyManager, positionId),
            dca.getPosition(strategyManager, positionId),
        ])

        const { inputToken, outputToken } = await dca.getPool(poolId)

        if (mode === StrategyBalanceModes.ALL)
            addOrCreateBalance(inputToken, inputTokenBalance)

        addOrCreateBalance(outputToken, outputTokenBalance)
    }

    // In the case of TestVault, users doesn't get any yield, it simply receives
    // the same amount of tokens as deposited. This serves only to test the
    // interaction between StrategyManager and the Vaults, not the vault rewards itself.
    // That's the reason why the amount of shares is being considered as the amount of want
    // to be received after position is close.
    if (mode === StrategyBalanceModes.ALL) {
        for (const vaultPosition of vaultPositions) {
            const { vault, amount } = vaultPosition

            const wantToken = await IBeefyVaultV7__factory.connect(vault, ethers.provider).want()

            addOrCreateBalance(wantToken, amount)
        }
    }

    for (const liquidityPosition of liquidityPositions) {
        const {
            fees,
            amount0,
            amount1,
            token0,
            token1,
        } = await LiquidityHelpers.getLiquidityPositionInfo(
            liquidityPosition.tokenId,
            await strategyManager.getLiquidityRewardFee(strategyId),
            NonFungiblePositionManager__factory.connect(
                liquidityPosition.positionManager,
                ethers.provider,
            ),
            uniswapFactoryV3,
            strategyManager,
        )

        if (mode === StrategyBalanceModes.ALL) {
            addOrCreateBalance(token0, amount0 + fees.amount0)
            addOrCreateBalance(token1, amount1 + fees.amount1)
        }
        else {
            addOrCreateBalance(token0, fees.amount0)
            addOrCreateBalance(token1, fees.amount1)
        }
    }

    return positionTokenBalances
}
