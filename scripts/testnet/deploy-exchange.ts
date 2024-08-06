import { findAddressOrFail, saveAddress, sendDeploymentTransaction } from '@src/helpers'
import {
    SwapRouter__factory,
    UniswapPositionManager__factory,
    UniswapV2Factory__factory,
    UniswapV2Router02__factory,
} from '@src/typechain'
import {
    bytecode as uniswapV3FactoryBytecode,
} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'
import {
    bytecode as uniswapV3RouterBytecode,
} from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'
import {
    bytecode as uniswapPositionManagerBytecode,
} from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
import { ZeroAddress } from 'ethers'
import hre from 'hardhat'
import { Storage } from 'hardhat-vanity'

async function deployUniswapV2() {
    const [deployer] = await hre.ethers.getSigners()
    const weth = await Storage.findAddress('WrappedEthereum')

    const factoryAddress = await sendDeploymentTransaction(
        UniswapV2Factory__factory.bytecode + UniswapV2Factory__factory
            .createInterface()
            .encodeDeploy([await deployer.getAddress()])
            .replace('0x', ''),
        deployer,
    )

    const routerAddress = await sendDeploymentTransaction(
        UniswapV2Router02__factory.bytecode + UniswapV2Router02__factory
            .createInterface()
            .encodeDeploy([factoryAddress, weth])
            .replace('0x', ''),
        deployer,
    )

    await saveAddress('UniswapFactoryV2', factoryAddress)
    await saveAddress('UniswapRouterV2', routerAddress)
}

async function deployUniswapV3() {
    const [deployer] = await hre.ethers.getSigners()
    const weth = await findAddressOrFail('WrappedEthereum')

    const factoryAddress = await sendDeploymentTransaction(
        uniswapV3FactoryBytecode,
        deployer,
    )
    const routerAddress = await sendDeploymentTransaction(
        uniswapV3RouterBytecode + SwapRouter__factory
            .createInterface()
            .encodeDeploy([factoryAddress, weth])
            .replace('0x', ''),
        deployer,
    )
    const positionManagerAddress = await sendDeploymentTransaction(
        uniswapPositionManagerBytecode + UniswapPositionManager__factory
            .createInterface()
            .encodeDeploy([
                factoryAddress,
                weth,
                ZeroAddress,
            ])
            .replace('0x', ''),
        deployer,
    )

    await saveAddress('UniswapFactoryV3', factoryAddress)
    await saveAddress('UniswapRouterV3', routerAddress)
    await saveAddress('UniswapPositionManagerV3', positionManagerAddress)
}

deployUniswapV2()
