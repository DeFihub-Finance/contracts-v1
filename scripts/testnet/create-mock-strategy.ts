import { NetworkService } from '@src/NetworkService'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { StrategyManager__factory, SubscriptionManager__factory } from '@src/typechain'
import hre from 'hardhat'
import { Storage } from 'hardhat-vanity'
import { ofetch } from 'ofetch'
import { sendTransaction } from '@src/helpers'
import { toKeccak256 } from '@defihub/shared'
import { mockStrategies } from '@src/constants'

const commitMetadataToBackend = true

async function createMockStrategy() {
    const [deployer] = await hre.ethers.getSigners()
    const strategyManagerAddress = await Storage.findAddress('StrategyManager')

    if (!strategyManagerAddress)
        throw new Error('create-mock-strategy: missing StrategyManager address')

    const strategyManager = StrategyManager__factory.connect(
        strategyManagerAddress,
        deployer,
    )
    const subscriptionManager = SubscriptionManager__factory.connect(
        await strategyManager.subscriptionManager(),
        deployer,
    )
    const deadline = await NetworkService.getBlockTimestamp() + 100_000

    const signature = await new SubscriptionSignature(subscriptionManager, deployer)
        .signSubscriptionPermit(await deployer.getAddress(), deadline)

    for (const strategy of mockStrategies) {
        try {
            if (commitMetadataToBackend) {
                await ofetch(process.env.DEFIHUB_API + '/strategies/metadata', {
                    method: 'POST',
                    body: {
                        name: strategy.name,
                        bio: strategy.bio,
                    },
                })
            }

            await sendTransaction(
                await strategyManager.createStrategy.populateTransaction({
                    dcaInvestments: strategy.dcaInvestments,
                    vaultInvestments: strategy.vaultInvestments,
                    liquidityInvestments: [],
                    permit: signature,
                    metadataHash: toKeccak256([strategy.name, strategy.bio]),
                }),
                deployer,
            )
        }
        catch (e) {
            console.log(
                'error sending transaction:',
                strategyManager.interface.parseError((e as { data: string }).data),
            )

            throw e
        }
    }
}

createMockStrategy()
