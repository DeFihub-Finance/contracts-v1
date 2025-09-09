import { AbiCoder, Signer } from 'ethers'
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
import { FeeOperation, FeeOperations, FeeTo, FeeToType, unwrapAddressLike } from '@defihub/shared'
import { FeeEvent } from '@src/typechain/artifacts/contracts/abstract/StrategyStorage'

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

export async function getAccountRewardsMap(
    account: Signer,
    tokens: Set<string>,
    strategyManager: StrategyManager__v4,
) {
    const liquidityRewardsMap: Record<string, bigint> = {}

    await Promise.all(
        Array.from(tokens).map(async token => {
            liquidityRewardsMap[token] = await strategyManager.getRewards(account, token)
        }),
    )

    return liquidityRewardsMap
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

export function encodeFeeEventBytes(
    strategyId: bigint,
    tokenAddress: string,
    feeTo: FeeToType,
    feeOp: FeeOperation,
) {
    return AbiCoder.defaultAbiCoder().encode(
        ['uint', 'address', 'uint8', 'uint8'],
        [strategyId, tokenAddress, feeTo, feeOp],
    )
}

export function decodeFeeEventBytes(bytes: string) {
    return AbiCoder.defaultAbiCoder().decode(
        // [strategyId, tokenAddress, feeTo, feeOp]
        ['uint', 'address', 'uint8', 'uint8'],
        bytes,
    )
}

/**
 * Get expected emitted Fee events when collecting or closing a position.
 *
 * @param treasury The treasury address
 * @param investor The investor address who owns the position
 * @param strategist The strategist address who owns the strategy
 * @param strategyId the ID of the strategy
 * @param positionId the ID of the position
 * @param strategyManager The strategy manager contract
 *
 * @returns an array of expected Fee events
 */
export async function getRewardsDistributionFeeEvents(
    treasury: Signer,
    investor: Signer,
    strategist: Signer,
    strategyId: bigint,
    positionId: bigint,
    strategyManager: StrategyManager__v4,
) {
    const [
        treasuryAddress,
        investorAddress,
        strategistAddress,
        positionsFees,
    ] = await Promise.all([
        unwrapAddressLike(treasury),
        unwrapAddressLike(investor),
        unwrapAddressLike(strategist),
        LiquidityHelpers.getPositionFeeAmounts(
            strategyId,
            positionId,
            investor,
            strategyManager,
        ),
    ])

    const expectedEvents: FeeEvent.OutputTuple[] = []

    for (const fees of positionsFees) {
        // Fee events are emitted first to strategist then to protocol
        for (const feeTo of [FeeTo.STRATEGIST, FeeTo.PROTOCOL]) {
            // Generate event for each token
            for (let index = 0; index < fees.tokens.length; index++) {
                expectedEvents.push([
                    investorAddress,
                    feeTo === FeeTo.PROTOCOL ? treasuryAddress : strategistAddress,
                    fees[feeTo][index],
                    encodeFeeEventBytes(strategyId, fees.tokens[index], feeTo, FeeOperations.LIQUIDITY_FEES),
                ])
            }
        }
    }

    return expectedEvents
}
