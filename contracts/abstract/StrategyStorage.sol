// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import {INonfungiblePositionManager} from '../interfaces/INonfungiblePositionManager.sol';
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

    /// @notice Represents a liquidity investment in Uniswap V3, allowing bounds to be set as percentage offsets or specific ticks.
    /// @dev When `usePercentageBounds` is true, `lowerBound` and `upperBound` are percentage offsets from the current price at the time of investment. When false, they represent actual tick values.
    struct LiquidityInvestment {
        INonfungiblePositionManager positionManager;
        uint8 percentage;
        IERC20Upgradeable token0;
        IERC20Upgradeable token1;
        uint24 fee; // The Uniswap V3 pool fee tier (e.g., 500, 3000, 10000)
        bool usePercentageBounds; // Determines if bounds are percentage offsets (true) or tick values (false)
        int24 lowerBound; // Lower bound as a percentage offset or tick value
        int24 upperBound; // Upper bound as a percentage offset or tick value
    }

    struct BuyInvestment {
        IERC20Upgradeable token;
        uint8 percentage;
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
        INonfungiblePositionManager positionManager;
        uint tokenId;
        uint128 liquidity;
    }

    struct BuyPosition {
        IERC20Upgradeable token;
        uint amount;
    }

    /* ----- CONSTANTS ----- */

    // PRODUCTS
    uint8 public constant PRODUCT_DCA = 0;
    uint8 public constant PRODUCT_VAULTS = 1;
    uint8 public constant PRODUCT_LIQUIDITY = 2;
    uint8 public constant PRODUCT_BUY = 3;

    // FEES
    uint8 public constant FEE_TO_PROTOCOL = 0;
    uint8 public constant FEE_TO_STRATEGIST = 1;
    uint8 public constant FEE_TO_REFERRER = 2;

    Strategy[] internal _strategies;
    mapping(uint => bool) internal _hottestStrategiesMapping;
    uint[] internal _hottestStrategiesArray;
    uint8 public maxHottestStrategies;

    mapping(address => uint) internal _strategistRewards;

    IERC20Upgradeable public stable;
    address public zapManager;
    SubscriptionManager public subscriptionManager;
    DollarCostAverage public dca;
    VaultManager public vaultManager;
    LiquidityManager public liquidityManager;
    UseFee public buyProduct;

    uint32 public strategistPercentage;
    uint32 public hotStrategistPercentage;

    mapping(uint => DcaInvestment[]) internal _dcaInvestmentsPerStrategy;
    mapping(uint => VaultInvestment[]) internal _vaultInvestmentsPerStrategy;
    mapping(uint => LiquidityInvestment[]) internal _liquidityInvestmentsPerStrategy;
    mapping(uint => BuyInvestment[]) internal _buyInvestmentsPerStrategy;

    mapping(address => Position[]) internal _positions;
    // @dev investor => strategy position id => dca position ids
    mapping(address => mapping(uint => uint[])) internal _dcaPositionsPerPosition;
    // @dev investor => strategy position id => vault positions
    mapping(address => mapping(uint => VaultPosition[])) internal _vaultPositionsPerPosition;
    // @dev investor => strategy position id => liquidity positions
    mapping(address => mapping(uint => LiquidityPosition[])) internal _liquidityPositionsPerPosition;
    // @dev investor => strategy position id => buy positions
    mapping(address => mapping(uint => BuyPosition[])) internal _buyPositionsPerPosition;

    event Fee(address from, address to, uint amount, bytes data);

    event PositionCreated(
        address user,
        uint strategyId,
        uint positionId,
        address inputToken,
        uint inputTokenAmount,
        uint stableAmountAfterFees,
        uint[] dcaPositionIds,
        VaultPosition[] vaultPositions,
        LiquidityPosition[] liquidityPositions,
        BuyPosition[] tokenPositions
    );

    event PositionClosed(
        address user,
        uint strategyId,
        uint positionId,
        uint[][] dcaWithdrawnAmounts,
        uint[] vaultWithdrawnAmount,
        uint[][] liquidityWithdrawnAmounts,
        uint[] buyWithdrawnAmounts
    );

    event PositionCollected(
        address user,
        uint strategyId,
        uint positionId,
        uint[] dcaWithdrawnAmounts,
        uint[][] liquidityWithdrawnAmounts,
        uint[] buyWithdrawnAmounts
    );
}
