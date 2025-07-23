// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {DollarCostAverage} from "./DollarCostAverage.sol";
import {HubRouter} from "./libraries/HubRouter.sol";

contract DollarCostAverage__Universal is DollarCostAverage {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct UniversalSwapInfo {
        uint208 poolId;
        bytes encodedSwap;
    }

    function swap(UniversalSwapInfo[] calldata swapInfos) external virtual {
        if (msg.sender != swapper)
            revert CallerIsNotSwapper();

        uint timestamp = block.timestamp;

        for (uint32 index; index < swapInfos.length; ++index) {
            uint208 poolId = swapInfos[index].poolId;

            if (poolId >= poolInfo.length)
                revert InvalidPoolId();

            PoolInfo storage pool = poolInfo[poolId];

            if (timestamp < pool.lastSwapTimestamp + pool.interval)
                revert TooEarlyToSwap(pool.lastSwapTimestamp + pool.interval - timestamp);

            uint inputTokenAmount = pool.nextSwapAmount;

            if (inputTokenAmount == 0)
                revert NoTokensToSwap();

            uint contractBalanceBeforeSwap = IERC20Upgradeable(pool.outputToken).balanceOf(address(this));

            uint outputTokenAmount = HubRouter.execute(
                swapInfos[index].encodedSwap,
                IERC20Upgradeable(pool.inputToken),
                IERC20Upgradeable(pool.outputToken),
                inputTokenAmount
            );
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

