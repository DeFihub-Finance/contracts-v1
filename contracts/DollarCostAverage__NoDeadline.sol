// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ISwapRouter__NoDeadline} from "./interfaces/ISwapRouter__NoDeadline.sol";
import {DollarCostAverage} from "./DollarCostAverage.sol";

contract DollarCostAverage__NoDeadline is DollarCostAverage {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
    * @notice Same function as `swap` in `DollarCostAverage`, but without the deadline parameter in the swap router.
    * @dev The function is only callable by the swapper.
    * @param swapInfo Array of `SwapInfo` structs, each containing the pool ID and the minimum output amount.
    */
    function swap(SwapInfo[] calldata swapInfo) external virtual override {
        if (msg.sender != swapper)
            revert CallerIsNotSwapper();

        uint timestamp = block.timestamp;

        for (uint32 i; i < swapInfo.length; ++i) {
            uint208 poolId = swapInfo[i].poolId;

            if (poolId >= poolInfo.length)
                revert InvalidPoolId();

            PoolInfo storage pool = poolInfo[poolId];

            if (timestamp < pool.lastSwapTimestamp + pool.interval)
                revert TooEarlyToSwap(pool.lastSwapTimestamp + pool.interval - timestamp);

            uint inputTokenAmount = pool.nextSwapAmount;

            if (inputTokenAmount == 0)
                revert NoTokensToSwap();

            uint contractBalanceBeforeSwap = IERC20Upgradeable(pool.outputToken).balanceOf(address(this));

            IERC20Upgradeable(pool.inputToken).safeApprove(pool.router, inputTokenAmount);
            ISwapRouter__NoDeadline(pool.router).exactInput(ISwapRouter__NoDeadline.ExactInputParams({
                path: pool.path,
                recipient: address(this),
                amountIn: inputTokenAmount,
                amountOutMinimum: swapInfo[i].minOutputAmount
            }));

            uint outputTokenAmount = IERC20Upgradeable(pool.outputToken).balanceOf(address(this)) - contractBalanceBeforeSwap;
            uint swapQuote = (outputTokenAmount * SWAP_QUOTE_PRECISION) / inputTokenAmount;
            mapping(uint16 => uint) storage poolAccruedQuotes = accruedSwapQuoteByPool[poolId];

            poolAccruedQuotes[pool.performedSwaps + 1] = poolAccruedQuotes[pool.performedSwaps] + swapQuote;

            pool.performedSwaps += 1;
            pool.nextSwapAmount -= endingPositionDeduction[poolId][pool.performedSwaps + 1];
            pool.lastSwapTimestamp = timestamp;

            emit Swap(poolId, inputTokenAmount, outputTokenAmount);
        }
    }
}

