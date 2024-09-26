// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {Swapper} from "./Swapper.sol";

contract SwapperUniswapV3 is Swapper {
    INonfungiblePositionManager public immutable positionManager;

    struct ConstructorParams {
        address positionManager;
        address swapRouter;
    }

    constructor(ConstructorParams memory _constructorParams) {
        positionManager = INonfungiblePositionManager(_constructorParams.positionManager);
        swapRouter = _constructorParams.swapRouter;
    }
}
