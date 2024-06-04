// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

interface ICall {
    error LowLevelCallFailed(address to, bytes inputData, bytes revertData);
}
