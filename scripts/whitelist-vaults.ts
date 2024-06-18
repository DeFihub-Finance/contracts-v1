import { findAddressOrFail, sendTransaction } from '@src/helpers'
import { VaultManager__factory } from '@src/typechain'
import hre from 'hardhat'

const vaults = [
    '0x61d93cd5CcBa9072E1E58A812fbC760820075a0b', // arb - aave usdc
    '0x5B904f19fb9ccf493b623e5c8cE91603665788b0', // arb - gmx
]
const useMultisig = true

async function sendTestnetTransaction() {
    const [deployer] = await hre.ethers.getSigners()
    const vaultManager = VaultManager__factory.connect(
        await findAddressOrFail('VaultManager'),
        deployer,
    )

    for (const vault of vaults) {
        await sendTransaction(
            await vaultManager
                .setVaultWhitelistStatus
                .populateTransaction(vault, true),
            deployer,
        )
    }
}

async function createProposal() {
    // TODO update this function so it sends the transaction directly to SAFE
    // const [deployer] = await hre.ethers.getSigners()
    // const admin = getDefenderClient()
    // const multisig = await findAddressOrFail('GnosisSafe')
    // const vaultManager = VaultManager__factory.connect(
    //     await findAddressOrFail('VaultManager'),
    //     deployer,
    // )
    //
    // for (const vault of vaults) {
    //     await admin.proposal.create({
    //         proposal: {
    //             contract: {
    //                 network,
    //                 address: await vaultManager.getAddress(),
    //             },
    //             title: 'Whitelist vault',
    //             description: 'todo',
    //             via: multisig,
    //             viaType: 'Safe',
    //             type: 'custom',
    //             functionInterface: {
    //                 name: 'setVaultWhitelistStatus',
    //                 inputs: VaultManager__factory.createInterface()
    //                     .getFunction('setVaultWhitelistStatus')
    //                     .inputs
    //                     .map(({ name, type }) => ({ name, type })),
    //             },
    //             functionInputs: [
    //                 vault,
    //                 true,
    //             ],
    //         },
    //     })
    // }
}

async function whitelistVaults() {
    useMultisig
        ? await createProposal()
        : await sendTestnetTransaction()
}

whitelistVaults()
