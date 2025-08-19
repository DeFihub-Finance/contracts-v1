// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {StrategyManager__v2} from './StrategyManager__v2.sol';
import {ReferralStorage} from "./libraries/ReferralStorage.sol";

contract StrategyManager__v3 is StrategyManager__v2 {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event ReferralLinked(address referrer, address referred, uint deadline);
    event CollectedRewards(address user, address token, uint amount);
    event ReferralDurationUpdated(uint duration);

    function initialize__v3(
        address _strategyInvestor,
        uint _referralDuration
    ) external onlyOwner reinitializer(3) {
        strategyInvestor = _strategyInvestor;

        ReferralStorage.getReferralStruct().referralDuration = _referralDuration;

        emit ReferralDurationUpdated(_referralDuration);
    }

    function collectRewards(address _token) public virtual {
        uint amount = getRewards(msg.sender, _token);

        if (amount == 0)
            return;

        if (_token == address(stable)) {
            _strategistRewards[msg.sender] = 0;
            ReferralStorage.getReferralStruct().referrerRewards[msg.sender] = 0;
        }

        IERC20Upgradeable(_token).safeTransfer(msg.sender, amount);

        emit CollectedRewards(msg.sender, _token, amount);
    }

    function collectManyRewards(address[] memory _tokens) external virtual {
        for (uint i = 0; i < _tokens.length; ++i)
            collectRewards(_tokens[i]);
    }

    function getRewards(address _strategist, address _token) public virtual view returns (uint) {
        if (_token == address(stable)) {
            uint strategistRewards = _strategistRewards[_strategist];
            uint referrerRewards = ReferralStorage.getReferralStruct().referrerRewards[_strategist];

            return strategistRewards + referrerRewards;
        }

        return 0;
    }

    function _setReferrer(address _referrer) internal virtual override {
        ReferralStorage.ReferralStruct storage referralStorage = ReferralStorage.getReferralStruct();

        // return if user is not a new investor
        if (referralStorage.investedBefore[msg.sender])
            return;

        referralStorage.investedBefore[msg.sender] = true;

        // ignores zero address and self-referral
        if (_referrer == address(0) || _referrer == msg.sender)
            return;

        uint deadline = block.timestamp + referralStorage.referralDuration;

        referralStorage.referrals[msg.sender] = _referrer;
        referralStorage.referralDeadlines[msg.sender] = deadline;

        emit ReferralLinked(_referrer, msg.sender, deadline);
    }
}
