// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract UseTreasury is OwnableUpgradeable {
    address public treasury;

    event TreasuryUpdated(address treasury);

    error InvalidZeroAddress();

    function setTreasury(address _treasury) public onlyOwner {
        if (_treasury == address(0))
            revert InvalidZeroAddress();

        treasury = _treasury;

        emit TreasuryUpdated(_treasury);
    }
}
