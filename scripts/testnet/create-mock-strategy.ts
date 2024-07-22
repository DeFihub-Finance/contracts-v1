import { NetworkService } from '@src/NetworkService'
import { SubscriptionSignature } from '@src/SubscriptionSignature'
import { StrategyManager__factory, SubscriptionManager__factory } from '@src/typechain'
import hre from 'hardhat'
import { Storage } from 'hardhat-vanity'
import { ofetch } from 'ofetch'
import { sendTransaction } from '@src/helpers'
import { toKeccak256, UniswapV3 } from '@defihub/shared'
import { mockStrategies } from '@src/constants'
import { mockTokenWithAddress } from '@src/helpers/mock-token'
import { BigNumber } from '@ryze-blockchain/ethereum'

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
                await ofetch('http://localhost:3333/strategies/metadata', {
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
                    liquidityInvestments: strategy.liquidityInvestments
                        ? await Promise.all(
                            strategy.liquidityInvestments.map(async investment => {
                                const { token0, token1 } = UniswapV3.sortTokens(
                                    await mockTokenWithAddress(new BigNumber(0), 18, investment.tokenA),
                                    await mockTokenWithAddress(new BigNumber(0), 18, investment.tokenB),
                                )

                                return {
                                    ...investment,
                                    token0: token0.address,
                                    token1: token1.address,
                                    fee: 3000,
                                }
                            }),
                        )
                        : [],
                    tokenInvestments: strategy.tokenInvestments || [],
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
        }
    }
}

createMockStrategy()
