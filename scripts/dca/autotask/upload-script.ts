import path from 'path'
import { ChainIds, ChainMap, chainRegistry } from '@ryze-blockchain/ethereum'
import { availableChains } from '@defihub/shared'
import { getDefenderClient } from '@src/helpers'

const autotaskIds: ChainMap<string> = {
    [ChainIds.ARBITRUM]: '56fc0ca0-d7fe-4ff6-8608-8031ce4cd9cf',
} as const

const main = async () => {
    const defender = getDefenderClient()

    for (const chainId of availableChains) {
        const autotaskId = autotaskIds[chainId]

        if (!autotaskId) {
            console.log(`No autotask ID found for chain ${ chainRegistry[chainId].name }`)

            continue
        }

        await defender.action.updateCodeFromFolder(
            autotaskId,
            { path: path.join(__dirname, '/build/') },
        )

        console.log(`Autotask code uploaded for chain ${ chainRegistry[chainId].name }`)
    }
}

main()
    .then(() => console.log('Autotask upload: done'))
    .catch(console.error)
