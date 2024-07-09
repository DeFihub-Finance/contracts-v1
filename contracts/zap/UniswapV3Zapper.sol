// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {IZapper} from "./IZapper.sol";
import {Swapper} from "./Swapper.sol";

contract UniswapV3Zapper is IZapper, Swapper {
    INonfungiblePositionManager public immutable positionManager;

    struct ConstructorParams {
        address positionManager;
        address swapRouter;
    }

    constructor(ConstructorParams memory _constructorParams) {
        positionManager = INonfungiblePositionManager(_constructorParams.positionManager);
        swapRouter = _constructorParams.swapRouter;
    }

    function zap(bytes memory) external pure {
        revert("NOT_IMPLEMENTED");
    }
}
