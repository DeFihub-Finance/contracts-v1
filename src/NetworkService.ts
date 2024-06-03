import { Chain, ChainId } from '@ryze-blockchain/ethereum'
import { ethers, network } from 'hardhat'

export class NetworkService {
    public static async impersonate(address: string) {
        await network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [address],
        })

        // should set an account balance of 10000 ETH
        await network.provider.request({
            method: 'hardhat_setBalance',
            params: [address, '0x56BC75E2D63100000'],
        })

        return ethers.getSigner(address)
    }

    public static async getBlockTimestamp(): Promise<number> {
        const blockTimestamp = (await ethers.provider.getBlock('latest'))?.timestamp

        if (!blockTimestamp)
            throw new Error('NetworkService::getBlockTimestamp: unable to fetch block')

        return blockTimestamp
    }

    public static async fastForwardChain(timeInSeconds: number): Promise<void> {
        return network.provider.send(
            'evm_increaseTime',
            [timeInSeconds],
        )
    }

    public static async getChainId(): Promise<ChainId> {
        const chainId = Chain.parseChainId((await ethers.provider.getNetwork()).chainId)

        if (!chainId)
            throw new Error('NetworkService::getChainId: unable to fetch chainId')

        return chainId
    }

    public static async getDeadline(ttl = 10_000): Promise<number> {
        return await NetworkService.getBlockTimestamp() + ttl
    }
}
