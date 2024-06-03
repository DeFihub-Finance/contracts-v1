// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

library MathHelpers {
    function min(uint _a, uint _b) internal pure returns (uint) {
        return _a > _b ? _b : _a;
    }

    function minU16(uint16 _a, uint16 _b) internal pure returns (uint16) {
        return _a > _b ? _b : _a;
    }
}
