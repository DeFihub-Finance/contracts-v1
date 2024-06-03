// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {INonfungiblePositionManager} from "./INonfungiblePositionManager.sol";
import {IZapper} from "./IZapper.sol";
import {Swapper} from "./Swapper.sol";

contract UniswapV3Zapper is IZapper, Swapper {
    INonfungiblePositionManager public immutable positionManager;

    struct ConstructorArgs {
        address positionManager;
        address swapRouter;
    }

    constructor(ConstructorArgs memory constructorArgs) {
        positionManager = INonfungiblePositionManager(constructorArgs.positionManager);
        swapRouter = constructorArgs.swapRouter;
    }

    function zap(bytes memory) external pure {
        revert("NOT_IMPLEMENTED");
    }
}
