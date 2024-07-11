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
        stablecoin,
        ...rest
    } = await createStrategyFixture()
    const strategistAddress = await account0.getAddress()
    const deadline = await NetworkService.getBlockTimestamp() + 10_000

    await Promise.all([
        stablecoin.mint(account1, amountToInvest),
        stablecoin.connect(account1).approve(strategyManager, amountToInvest),
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
        stablecoin,
        ...rest,
    }
}
