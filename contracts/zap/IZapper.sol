// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {ICall} from "../interfaces/ICall.sol";

interface IZapper is ICall {
    event Zapped(address router, bytes data);

    function zap(bytes memory data) external;
}
