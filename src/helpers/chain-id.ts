import { Chain } from '@ryze-blockchain/ethereum'
import hre from 'hardhat'

export async function getChainId() {
    return Chain.parseChainIdOrFail((await hre.ethers.provider.getNetwork()).chainId)
}
