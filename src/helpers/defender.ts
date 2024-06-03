import type { Network } from '@openzeppelin/defender-base-client'
import { Defender } from '@openzeppelin/defender-sdk'
import { type ChainId, ChainIds, type  ChainMap } from '@ryze-blockchain/ethereum'

const chainToNetworkMap: ChainMap<Network> = {
    [ChainIds.ARBITRUM]: 'arbitrum',
    [ChainIds.BNB]: 'bsc',
    [ChainIds.BNB_TESTNET]: 'bsctest',
}

export function chainToNetwork(chainId: ChainId) {
    const network = chainToNetworkMap[chainId]

    if (!network)
        throw new Error('chainToNetwork: Unsupported chain')

    return network
}

export function getDefenderClient() {
    const defenderKey = process.env.DEFENDER_API_KEY
    const defenderSecret = process.env.DEFENDER_API_SECRET

    if (!defenderKey)
        throw new Error('create-dca-pool: missing Defender key')

    if (!defenderSecret)
        throw new Error('create-dca-pool: missing Defender secret')

    return new Defender({
        apiKey: defenderKey,
        apiSecret: defenderSecret,
    })
}
