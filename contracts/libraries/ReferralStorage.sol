// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

library ReferralStorage {
    bytes32 constant private REFERRAL_STORAGE_POSITION = keccak256("referral.storage");

    struct ReferralStruct {
        mapping(address => bool) investedBefore;
        mapping(address => address) referrals;
        mapping(address => uint) referrerRewards;
        uint32 referrerPercentage;
    }

    function getReferralStruct() internal pure returns (ReferralStruct storage referralStruct) {
        bytes32 position = REFERRAL_STORAGE_POSITION;

        assembly {
            referralStruct.slot := position
        }
    }
}
