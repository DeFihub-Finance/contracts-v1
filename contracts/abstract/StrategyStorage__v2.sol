// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

contract StrategyStorage__v2 {
    /// @dev referrals should be part of StrategyStorage.sol, but since it is an upgrade, we can't change the storage of deployed contracts, therefore we have to pass it as an argument to StrategyInvestor.sol. In case of a new deployment this could be moved to StrategyStorage and no longer need to be passed as an argument to StrategyInvestor.
    mapping(address => address) public referrals;
    mapping(address => uint) internal _referrerRewards;

    uint32 public referrerPercentage;
}
