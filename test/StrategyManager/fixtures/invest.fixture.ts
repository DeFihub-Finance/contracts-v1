import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { createStrategyFixture } from './create-strategy.fixture'
import { parseEther } from 'ethers'
import { NetworkService } from '@src/NetworkService'

export async function investFixture() {
    const strategyId = 0
    const amountToInvest = parseEther('10')

    const {
        account0,
        account1,
        strategyManager,
        subscriptionSignature,
        token,
        stablecoin,
        ...rest
    } = await loadFixture(createStrategyFixture)
    const strategistAddress = await account0.getAddress()
    const deadline = await NetworkService.getBlockTimestamp() + 10_000

    await Promise.all([
        token.mint(await account1.getAddress(), amountToInvest),
        token.connect(account1).approve(
            await strategyManager.getAddress(),
            amountToInvest,
        ),
    ])

    await strategyManager.connect(account1).invest({
        strategyId,
        inputToken: stablecoin,
        inputAmount: amountToInvest,
        inputTokenSwap: '0x',
        dcaSwaps: ['0x', '0x'],
        vaultSwaps: ['0x'],
        tokenSwaps: [],
        liquidityZaps: [],
        investorPermit: await subscriptionSignature
            .signSubscriptionPermit(await account1.getAddress(), deadline),
        strategistPermit: await subscriptionSignature
            .signSubscriptionPermit(strategistAddress, deadline),
    })

    return {
        account0,
        account1,
        strategistAddress,
        strategyManager,
        strategyId,
        amountToInvest,
        rewardToken: token,
        ...rest,
    }
}
