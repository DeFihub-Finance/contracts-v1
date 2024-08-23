// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";


import {ZapManager} from '../zap/ZapManager.sol';
import {SubscriptionManager} from '../SubscriptionManager.sol';
import {LiquidityManager} from '../LiquidityManager.sol';
import {VaultManager} from "../VaultManager.sol";
import {DollarCostAverage} from '../DollarCostAverage.sol';
import {UseTreasury} from "./UseTreasury.sol";
import {UseFee} from "./UseFee.sol";

contract StrategyStorage is UseTreasury {
    // @notice percentages is a mapping from product id to its percentage
    struct Strategy {
        address creator;
        mapping(uint8 => uint8) percentages;
    }

    Strategy[] internal _strategies;

    mapping(address => uint) internal _strategistRewards;

    uint8 public constant PRODUCT_DCA = 0;
    uint8 public constant PRODUCT_VAULTS = 1;
    uint8 public constant PRODUCT_LIQUIDITY = 2;
    uint8 public constant PRODUCT_BUY = 3;

    IERC20Upgradeable public stable;
    ZapManager public zapManager;
    SubscriptionManager public subscriptionManager;
    DollarCostAverage public dca;
    VaultManager public vaultManager;
    LiquidityManager public liquidityManager;
    UseFee public buyProduct;

    uint32 public strategistPercentage;
    uint32 public hotStrategistPercentage;
}
