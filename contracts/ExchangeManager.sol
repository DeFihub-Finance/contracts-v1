// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {HubOwnable} from "./abstract/HubOwnable.sol";
import {UseFee} from "./abstract/UseFee.sol";

/// @dev This contract is an implementation of the UseFee contract for the Tokens product used in strategies
contract ExchangeManager is HubOwnable, UseFee {
    struct InitializeParams {
        address owner;
        address treasury;
        address subscriptionManager;
        uint32 baseFeeBP;
        uint32 nonSubscriberFeeBP;
    }

    function initialize(InitializeParams memory _params) public initializer {
        __Ownable_init();
        __UseFee_init(
            _params.treasury,
            _params.subscriptionManager,
            _params.baseFeeBP,
            _params.nonSubscriberFeeBP
        );

        transferOwnership(_params.owner);
    }
}
