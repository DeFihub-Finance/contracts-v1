import { Signer, Signature } from 'ethers'
import { SubscriptionManager } from '@src/typechain'
import { NetworkService } from './NetworkService'

export class SubscriptionSignature {
    constructor(
        private subscriptionManager: SubscriptionManager,
        private subscriptionSigner: Signer,
    ) {}

    async signSubscriptionPermit(
        user: string,
        deadline: number,
    ): Promise<SubscriptionManager.PermitStruct> {
        const verifyingContract = await this.subscriptionManager.getAddress()
        const chainId = await NetworkService.getChainId()

        // Define the domain
        const domain = {
            name: 'defihub.fi',
            version: '1',
            chainId: chainId,
            verifyingContract,
        }

        // Define the types
        const types = {
            SubscriptionPermit: [
                // This should match the primary type in the Solidity contract
                { type: 'address', name: 'user' },
                { type: 'uint256', name: 'deadline' },
            ],
        }

        // Create the message
        const message = {
            user,
            deadline,
        }

        // Sign the typed data
        const signature = Signature.from(
            await this.subscriptionSigner.signTypedData(domain, types, message),
        )

        return {
            deadline,
            r: signature.r,
            s: signature.s,
            v: signature.v,
        }
    }
}
