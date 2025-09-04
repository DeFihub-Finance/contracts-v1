// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

library LiquidityStorage {
    bytes32 constant private LIQUIDITY_FEE_STORAGE_POSITION = keccak256("liquidity.fee.storage");

    struct LiquidityStorageStruct {
        uint32 strategistRewardFeeSplitBP; // amount of the liquidity fee that goes to the strategist, the remaining goes to the protocol
        mapping(address => mapping(address => uint)) rewardBalances;
        mapping(uint => uint32) strategiesLiquidityFeeBP;
    }

    function getLiquidityStruct() internal pure returns (
        LiquidityStorageStruct storage liquidityFeeStorageStruct
    ) {
        bytes32 position = LIQUIDITY_FEE_STORAGE_POSITION;

        assembly {
            liquidityFeeStorageStruct.slot := position
        }
    }
}
