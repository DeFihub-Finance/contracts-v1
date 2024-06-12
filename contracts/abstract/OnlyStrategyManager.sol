// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

abstract contract OnlyStrategyManager is Initializable {
    address public strategyManager;

    error Unauthorized();

    modifier onlyStrategyManager() {
        if (msg.sender != strategyManager)
            revert Unauthorized();

        _;
    }

    function __OnlyStrategyManager_init(
        address _strategyManager
    ) internal onlyInitializing {
        strategyManager = _strategyManager;
    }
}
