import { keccak256, parseEther } from 'ethers'
import { NetworkService } from '@src/NetworkService'
import { baseStrategyManagerFixture } from './base.fixture'

export const createStrategyFixture = async () => {
    /////////////////////////////////////
    // Initializing contracts and EOA //
    ///////////////////////////////////
    const {
        account0,
        account1,
        account2,
        token,
        anotherToken,
        strategyManager,
        dcaStrategyPositions,
        vaultStrategyPosition,
        subscriptionSignature,
        ...rest
    } = await baseStrategyManagerFixture()
    const nameBioHash = keccak256(new TextEncoder().encode('Name' + 'Bio'))

    await strategyManager.setHotStrategistPercentage(30)

    //////////////////////////////////////////////
    // Approve StrategyManager to spend tokens //
    /////////////////////////////////////////////
    await Promise.all([
        token.mint(await account1.getAddress(), parseEther('1000')),
        token.connect(account1).approve(await strategyManager.getAddress(), parseEther('1000')),
        token.mint(await account2.getAddress(), parseEther('1000')),
        token.connect(account2).approve(await strategyManager.getAddress(), parseEther('1000')),
        anotherToken.connect(account1).mint(await account1.getAddress(), parseEther('1000')),
        anotherToken.connect(account1).approve(await strategyManager.getAddress(), parseEther('1000')),
    ])

    /////////////////////////////////////////
    // Create default strategy for tests  //
    ////////////////////////////////////////
    await strategyManager.connect(account0).createStrategy({
        dcaInvestments: dcaStrategyPositions,
        vaultInvestments: vaultStrategyPosition,
        liquidityInvestments: [], // todo
        permit: await subscriptionSignature.signSubscriptionPermit(
            await account0.getAddress(),
            await NetworkService.getBlockTimestamp() + 10_000,
        ),
        metadataHash: nameBioHash,
    })

    //////////////////////////////////////////////
    // Create strategy for swap and deposit test//
    //////////////////////////////////////////////
    await strategyManager.connect(account0).createStrategy({
        dcaInvestments: [{ poolId: 2, swaps: 10, percentage: 66 }],
        vaultInvestments: vaultStrategyPosition,
        liquidityInvestments: [], // todo
        permit: await subscriptionSignature.signSubscriptionPermit(
            await account0.getAddress(),
            await NetworkService.getBlockTimestamp() + 10_000,
        ),
        metadataHash: nameBioHash,
    })

    return {
        account0,
        account1,
        account2,
        token,
        anotherToken,
        strategyManager,
        dcaStrategyPositions,
        vaultStrategyPosition,
        subscriptionSignature,

        ...rest,
    }
}
