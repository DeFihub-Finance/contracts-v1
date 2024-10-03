// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {INonfungiblePositionManager} from "../interfaces/INonfungiblePositionManager.sol";
import {Swapper} from "./Swapper.sol";

contract SwapperUniswapV3 is Swapper {
    struct ConstructorParams {
        address swapRouter;
    }

    constructor(ConstructorParams memory _constructorParams) {
        swapRouter = _constructorParams.swapRouter;
    }
}
