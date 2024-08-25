// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import {INonfungiblePositionManager} from '../interfaces/INonfungiblePositionManager.sol';
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

    /**
     * Position structs
     *
     * Interfaces for users' positions to be stored in the Strategy contract
     */
    struct Position {
        uint strategyId;
        bool closed;
    }

    struct VaultPosition {
        address vault;
        uint amount;
    }

    struct LiquidityPosition {
        // TODO check if position manager is really necessary since it is already available in LiquidityInvestment struct
        INonfungiblePositionManager positionManager;
        uint tokenId;
        uint128 liquidity;
    }

    struct BuyPosition {
        IERC20Upgradeable token;
        uint amount;
    }

    /**
     * Investment structs
     *
     * Interfaces of how investments are stored for each product in a strategy
     */

    struct DcaInvestment {
        uint208 poolId;
        uint16 swaps;
        uint8 percentage;
    }

    struct VaultInvestment {
        address vault;
        uint8 percentage;
    }

    struct LiquidityInvestment {
        INonfungiblePositionManager positionManager;
        IERC20Upgradeable token0;
        IERC20Upgradeable token1;
        uint24 fee;
        uint24 lowerPricePercentage;
        uint24 upperPricePercentage;
        uint8 percentage;
    }

    struct BuyInvestment {
        IERC20Upgradeable token;
        uint8 percentage;
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

    mapping(address => Position[]) internal _positions;
    // @dev investor => strategy position id => dca position ids
    mapping(address => mapping(uint => uint[])) internal _dcaPositionsPerPosition;
    // @dev investor => strategy position id => vault positions
    mapping(address => mapping(uint => VaultPosition[])) internal _vaultPositionsPerPosition;
    // @dev investor => strategy position id => liquidity positions
    mapping(address => mapping(uint => LiquidityPosition[])) internal _liquidityPositionsPerPosition;
    // @dev investor => strategy position id => buy positions
    mapping(address => mapping(uint => BuyPosition[])) internal _buyPositionsPerPosition;

    mapping(uint => DcaInvestment[]) internal _dcaInvestmentsPerStrategy;
    mapping(uint => VaultInvestment[]) internal _vaultInvestmentsPerStrategy;
    mapping(uint => LiquidityInvestment[]) internal _liquidityInvestmentsPerStrategy;
    mapping(uint => BuyInvestment[]) internal _buyInvestmentsPerStrategy;
}
