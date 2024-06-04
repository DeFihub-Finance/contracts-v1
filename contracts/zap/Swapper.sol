// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ICall} from "../interfaces/ICall.sol";

abstract contract Swapper is ICall {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev swap bytes must include the signature and data of the desired router function
     */
    struct SwapData {
        address inputToken;
        uint inputAmount;
        bytes swap;
    }

    address public immutable swapRouter;

    event Swapped(address router, bytes data);

    function swap(bytes memory rawData) public virtual {
        SwapData memory swapData = abi.decode(rawData, (SwapData));
        IERC20Upgradeable inputToken = IERC20Upgradeable(swapData.inputToken);

        // its safe to infinite approve because uni router is trusted and this contract doesn't hold any tokens
        if (inputToken.allowance(address(this), swapRouter) < swapData.inputAmount)
            inputToken.safeApprove(swapRouter, type(uint).max);

        (bool success, bytes memory data) = swapRouter.call(swapData.swap);

        if (!success)
            revert LowLevelCallFailed(swapRouter, swapData.swap, data);

        emit Swapped(swapRouter, data);
    }
}
