import { findAddressOrFail, sendDeploymentTransaction, sendTransaction } from '@src/helpers'
import { BeefyMockStrategy__factory, BeefyVaultV7__factory } from '@src/typechain'
import hre from 'hardhat'

const token = 'WrappedEthereum'
const vaultName = 'ETH Vault'
const vaultSymbol = 'mooETH'

async function deployVault() {
    const [deployer] = await hre.ethers.getSigners()
    const vaultAddress = await sendDeploymentTransaction(
        BeefyVaultV7__factory.bytecode,
        deployer,
    )
    const strategyAddress = await sendDeploymentTransaction(
        BeefyMockStrategy__factory.bytecode,
        deployer,
    )

    await sendTransaction(
        await BeefyVaultV7__factory.connect(vaultAddress, deployer)
            .initialize
            .populateTransaction(
                strategyAddress,
                vaultName,
                vaultSymbol,
                0,
            ),
        deployer,
    )

    await sendTransaction(
        await BeefyMockStrategy__factory.connect(strategyAddress, deployer)
            .initialize
            .populateTransaction(
                vaultAddress,
                await findAddressOrFail(token),
            ),
        deployer,
    )
}

deployVault()
