import { findAddressOrFail, sendTransaction } from '@src/helpers'
import { StrategyManager__factory, TestERC20__factory } from '@src/typechain'
import { parseUnits, ZeroHash } from 'ethers'
import hre from 'hardhat'

async function strategyDeposit() {
    const [deployer] = await hre.ethers.getSigners()
    const strategyManagerAddress = await findAddressOrFail('StrategyManager')
    const amount = parseUnits('30000', 18)
    const emptySignature = {
        deadline: 0,
        v: 0,
        r: ZeroHash,
        s: ZeroHash,
    }

    await sendTransaction(
        await TestERC20__factory
            .connect(await findAddressOrFail('Stablecoin'))
            .approve
            .populateTransaction(strategyManagerAddress, amount),
        deployer,
    )

    try{
        await sendTransaction(
            await StrategyManager__factory
                .connect(strategyManagerAddress, deployer)
                .invest
                .populateTransaction(
                    0,
                    amount,
                    ['0x', '0x'],
                    [],
                    emptySignature,
                    emptySignature,
                ),
            deployer,
        )
    }
    catch (e) {
        console.log(
            'error sending transaction:',
            StrategyManager__factory.createInterface().parseError((e as { data: string }).data),
        )
    }
}

strategyDeposit()
