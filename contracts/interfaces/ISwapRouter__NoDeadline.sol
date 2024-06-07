// SPDX-License-Identifier: MIT

pragma solidity >=0.6.2;

interface ISwapRouter__NoDeadline {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(
        ExactInputParams calldata params
    ) external payable returns (
        uint256 amountOut
    );
}
