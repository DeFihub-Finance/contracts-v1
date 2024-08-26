// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

// TODO review for unnecessary imports
import {HubOwnable} from "./abstract/HubOwnable.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {StrategyStorage} from "./abstract/StrategyStorage.sol";
import {ICall} from './interfaces/ICall.sol';
import {IBeefyVaultV7} from './interfaces/IBeefyVaultV7.sol';
import {SubscriptionManager} from "./SubscriptionManager.sol";
import {ZapManager} from './zap/ZapManager.sol';
import {LiquidityManager} from './LiquidityManager.sol';
import {VaultManager} from "./VaultManager.sol";
import {DollarCostAverage} from './DollarCostAverage.sol';
import {StrategyInvestor} from "./abstract/StrategyInvestor.sol";
import {ZapLib} from "./libraries/ZapLib.sol";
import {StrategyPositionManager} from "./abstract/StrategyPositionManager.sol";

contract StrategyManager is StrategyStorage, HubOwnable, ICall {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct InitializeParams {
        address owner;
        address treasury;
        address strategyInvestor;
        address strategyPositionManager;
        IERC20Upgradeable stable;
        SubscriptionManager subscriptionManager;
        DollarCostAverage dca;
        VaultManager vaultManager;
        LiquidityManager liquidityManager;
        UseFee buyProduct;
        ZapManager zapManager;
        uint8 maxHottestStrategies;
        uint32 strategistPercentage;
        uint32 hotStrategistPercentage;
    }

    struct CreateStrategyParams {
        StrategyStorage.DcaInvestment[] dcaInvestments;
        StrategyStorage.VaultInvestment[] vaultInvestments;
        StrategyStorage.LiquidityInvestment[] liquidityInvestments;
        StrategyStorage.BuyInvestment[] buyInvestments;
        SubscriptionManager.Permit permit;
        bytes32 metadataHash;
    }

    struct InvestInProductParams {
        uint strategyId;
        uint amount;
        bytes[] swaps;
    }

    address public strategyInvestor;
    address public strategyPositionManager;

    event StrategyCreated(address strategist, uint strategyId, bytes32 metadataHash);
    event CollectedStrategistRewards(address strategist, uint amount);
    event StrategistPercentageUpdated(uint32 discountPercentage);
    event HotStrategistPercentageUpdated(uint32 discountPercentage);
    event HottestStrategiesUpdated(uint[] strategies);
    event MaxHotStrategiesUpdated(uint8 max);

    error Unauthorized();
    error LimitExceeded();
    error InvalidTotalPercentage();
    error InvalidInvestment();
    error PercentageTooHigh();

    function initialize(InitializeParams calldata _initializeParams) external initializer {
        __Ownable_init();

        setMaxHottestStrategies(_initializeParams.maxHottestStrategies);
        setStrategistPercentage(_initializeParams.strategistPercentage);
        setHotStrategistPercentage(_initializeParams.hotStrategistPercentage);
        setTreasury(_initializeParams.treasury);

        transferOwnership(_initializeParams.owner);

        zapManager = _initializeParams.zapManager;
        strategyInvestor = _initializeParams.strategyInvestor;
        strategyPositionManager = _initializeParams.strategyPositionManager;
        stable = _initializeParams.stable;
        subscriptionManager = _initializeParams.subscriptionManager;
        dca = _initializeParams.dca;
        vaultManager = _initializeParams.vaultManager;
        liquidityManager = _initializeParams.liquidityManager;
        buyProduct = _initializeParams.buyProduct;
    }

    function createStrategy(CreateStrategyParams memory _params) external virtual {
        uint investmentCount = _params.dcaInvestments.length + _params.vaultInvestments.length;

        if (!subscriptionManager.isSubscribed(msg.sender, _params.permit))
            revert Unauthorized();

        if (investmentCount > 20)
            revert LimitExceeded();

        uint8 dcaPercentage;
        uint8 vaultPercentage;
        uint8 liquidityPercentage;
        uint8 tokenPercentage;

        for (uint i; i < _params.dcaInvestments.length; ++i)
            dcaPercentage += _params.dcaInvestments[i].percentage;

        for (uint i; i < _params.vaultInvestments.length; ++i)
            vaultPercentage += _params.vaultInvestments[i].percentage;

        for (uint i; i < _params.liquidityInvestments.length; ++i)
            liquidityPercentage += _params.liquidityInvestments[i].percentage;

        for (uint i; i < _params.buyInvestments.length; ++i)
            tokenPercentage += _params.buyInvestments[i].percentage;

        if (dcaPercentage + vaultPercentage + liquidityPercentage + tokenPercentage != 100)
            revert InvalidTotalPercentage();

        uint strategyId = _strategies.length;

        Strategy storage strategy = _strategies.push();
        strategy.creator = msg.sender;
        strategy.percentages[PRODUCT_DCA] = dcaPercentage;
        strategy.percentages[PRODUCT_VAULTS] = vaultPercentage;
        strategy.percentages[PRODUCT_LIQUIDITY] = liquidityPercentage;
        strategy.percentages[PRODUCT_BUY] = tokenPercentage;

        // Assigning isn't possible because you can't convert an array of structs from memory to storage
        for (uint i; i < _params.dcaInvestments.length; ++i) {
            StrategyStorage.DcaInvestment memory dcaStrategy = _params.dcaInvestments[i];

            if (dcaStrategy.poolId >= dca.getPoolsLength())
                revert DollarCostAverage.InvalidPoolId();

            if (dcaStrategy.swaps == 0)
                revert DollarCostAverage.InvalidNumberOfSwaps();

            _dcaInvestmentsPerStrategy[strategyId].push(dcaStrategy);
        }

        for (uint i; i < _params.vaultInvestments.length; ++i) {
            StrategyStorage.VaultInvestment memory vaultStrategy = _params.vaultInvestments[i];

            _vaultInvestmentsPerStrategy[strategyId].push(vaultStrategy);
        }

        for (uint i; i < _params.liquidityInvestments.length; ++i) {
            StrategyStorage.LiquidityInvestment memory liquidityStrategy = _params.liquidityInvestments[i];

            if (liquidityStrategy.token0 >= liquidityStrategy.token1)
                revert InvalidInvestment();

            _liquidityInvestmentsPerStrategy[strategyId].push(liquidityStrategy);
        }

        for (uint i; i < _params.buyInvestments.length; ++i)
            _buyInvestmentsPerStrategy[strategyId].push(_params.buyInvestments[i]);

        emit StrategyCreated(msg.sender, strategyId, _params.metadataHash);
    }

    // TODO might be optimized by inputing bytes instead
    function invest(StrategyInvestor.InvestParams calldata _params) external virtual {
        _makeDelegateCall(
            strategyInvestor,
            abi.encodeWithSelector(StrategyInvestor.invest.selector, _params)
        );
    }

    // TODO might be optimized by inputing bytes instead
    function closePosition(
        uint _positionId,
        StrategyPositionManager.LiquidityMinOutputs[] calldata _liquidityMinOutputs
    ) external virtual {
        _makeDelegateCall(
            strategyPositionManager,
            abi.encodeWithSelector(StrategyPositionManager.closePosition.selector, _positionId, _liquidityMinOutputs)
        );
    }

    // TODO might be optimized by inputing bytes instead
    function collectPosition(uint _positionId) external virtual {
        _makeDelegateCall(
            strategyPositionManager,
            abi.encodeWithSelector(StrategyPositionManager.collectPosition.selector, _positionId)
        );
    }

    function collectStrategistRewards() public virtual {
        uint strategistReward = _strategistRewards[msg.sender];

        _strategistRewards[msg.sender] = 0;
        stable.safeTransfer(msg.sender, strategistReward);

        emit CollectedStrategistRewards(msg.sender, strategistReward);
    }

    /**
     * ----- Getters -----
     */

    function getStrategistRewards(address _strategist) external virtual view returns (uint) {
        return _strategistRewards[_strategist];
    }

    function getPositionsLength(address _investor) external virtual view returns (uint) {
        return _positions[_investor].length;
    }

    function getPosition(
        address _investor,
        uint _index
    ) external virtual view returns (Position memory) {
        return _positions[_investor][_index];
    }

    function getPositionInvestments(
        address _investor,
        uint _positionId
    ) external virtual view returns (
        uint[] memory dcaPositions,
        StrategyStorage.VaultPosition[] memory vaultPositions,
        StrategyStorage.LiquidityPosition[] memory liquidityPositions,
        StrategyStorage.BuyPosition[] memory buyPositions
    ) {
        return (
            _dcaPositionsPerPosition[_investor][_positionId],
            _vaultPositionsPerPosition[_investor][_positionId],
            _liquidityPositionsPerPosition[_investor][_positionId],
            _buyPositionsPerPosition[_investor][_positionId]
        );
    }

    function getPositions(address _investor) external virtual view returns (Position[] memory) {
        return _positions[_investor];
    }

    function getStrategyCreator(uint _strategyId) external virtual view returns (address) {
        return _strategies[_strategyId].creator;
    }

    function getStrategyInvestments(
        uint _strategyId
    ) external virtual view returns (
        StrategyStorage.DcaInvestment[] memory dcaInvestments,
        StrategyStorage.VaultInvestment[] memory vaultInvestments,
        StrategyStorage.LiquidityInvestment[] memory liquidityInvestments,
        StrategyStorage.BuyInvestment[] memory buyInvestments
    ) {
        return (
            _dcaInvestmentsPerStrategy[_strategyId],
            _vaultInvestmentsPerStrategy[_strategyId],
            _liquidityInvestmentsPerStrategy[_strategyId],
            _buyInvestmentsPerStrategy[_strategyId]
        );
    }

    function getStrategiesLength() external virtual view returns (uint) {
        return _strategies.length;
    }

    function getHotStrategies() external virtual view returns (uint[] memory) {
        return _hottestStrategiesArray;
    }

    function isHot(uint _strategyId) external virtual view returns (bool) {
        return _hottestStrategiesMapping[_strategyId];
    }

    /**
     * ----- Internal functions -----
     */

    function _makeDelegateCall(
        address _target,
        bytes memory _callData
    ) internal returns (
        bytes memory
    ) {
        (bool success, bytes memory resultData) = _target.delegatecall(_callData);

        if (!success)
            revert LowLevelCallFailed(_target, "", resultData);

        return resultData;
    }

    /**
     * ----- Contract management -----
     */

    function setStrategistPercentage(uint32 _strategistPercentage) public virtual onlyOwner {
        if (_strategistPercentage > 100)
            revert PercentageTooHigh();

        strategistPercentage = _strategistPercentage;

        emit StrategistPercentageUpdated(_strategistPercentage);
    }

    function setHotStrategistPercentage(uint32 _hotStrategistPercentage) public virtual onlyOwner {
        if (_hotStrategistPercentage > 100)
            revert PercentageTooHigh();

        hotStrategistPercentage = _hotStrategistPercentage;

        emit HotStrategistPercentageUpdated(_hotStrategistPercentage);
    }

    function setHottestStrategies(uint[] calldata _strategyIds) external virtual onlyOwner {
        if (_strategyIds.length > maxHottestStrategies)
            revert LimitExceeded();

        for (uint i; i < _hottestStrategiesArray.length; ++i)
            _hottestStrategiesMapping[_hottestStrategiesArray[i]] = false;

        for (uint i; i < _strategyIds.length; ++i)
            _hottestStrategiesMapping[_strategyIds[i]] = true;

        _hottestStrategiesArray = _strategyIds;

        emit HottestStrategiesUpdated(_strategyIds);
    }

    function setMaxHottestStrategies(uint8 _maxHottestStrategies) public virtual onlyOwner {
        maxHottestStrategies = _maxHottestStrategies;

        emit MaxHotStrategiesUpdated(_maxHottestStrategies);
    }
}
