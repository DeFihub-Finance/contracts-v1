// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {SubscriptionManager} from "../SubscriptionManager.sol";

abstract contract UseFee is OwnableUpgradeable {
    SubscriptionManager public subscriptionManager;
    uint32 constant public MAX_FEE = 1_000;
    uint32 public baseFeeBP;
    uint32 public nonSubscriberFeeBP;

    event Fee(address from, address to, uint amount, bytes data);
    event FeeUpdated(uint32 baseFeeBP, uint nonSubscriberFeeBP);

    error FeeTooHigh();

    function __UseFee_init(
        address _subscriptionManager,
        uint32 _baseFeeBP,
        uint32 _nonSubscriberFeeBP
    ) internal onlyInitializing {
        subscriptionManager = SubscriptionManager(_subscriptionManager);
        _setFee(_baseFeeBP, _nonSubscriberFeeBP);
    }

    function calculateFee(
        address _user,
        uint _amount,
        SubscriptionManager.Permit calldata _permit
    ) public view returns (uint baseFee, uint nonSubscriberFee) {
        return (
            _getBaseFee(_amount),
            _getNonSubscriberFee(_user, _amount, _permit)
        );
    }

    function _getBaseFee(uint _amount) private view returns (uint) {
        return _amount * baseFeeBP / 10_000;
    }

    function _getNonSubscriberFee(
        address _user,
        uint _amount,
        SubscriptionManager.Permit calldata _permit
    ) private view returns (uint) {
        return subscriptionManager.isSubscribed(_user, _permit)
            ? 0
            : _amount * nonSubscriberFeeBP / 10_000;
    }

    function setFee(uint32 _baseFeeBP, uint32 _nonSubscriberFeeBP) external onlyOwner {
        _setFee(_baseFeeBP, _nonSubscriberFeeBP);
    }

    function _setFee(uint32 _baseFeeBP, uint32 _nonSubscriberFeeBP) internal {
        if (_baseFeeBP > MAX_FEE || _nonSubscriberFeeBP > MAX_FEE)
            revert FeeTooHigh();

        baseFeeBP = _baseFeeBP;
        nonSubscriberFeeBP = _nonSubscriberFeeBP;

        emit FeeUpdated(_baseFeeBP, _nonSubscriberFeeBP);
    }
}
