// SPDX-License-Identifier: MIT
pragma solidity 0.8.22;

import {UseFee} from "../abstract/UseFee.sol";

contract TestFee is UseFee {
    function initialize(
        address _treasury,
        address _subscriptionManager,
        uint32 _baseFeeBP,
        uint32 _nonSubscriberFeeBP
    ) external initializer {
        __Ownable_init();
        __UseFee_init(_treasury, _subscriptionManager, _baseFeeBP, _nonSubscriberFeeBP);
        transferOwnership(msg.sender);
    }
}
