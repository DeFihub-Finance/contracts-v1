// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {HubOwnable} from "./abstract/HubOwnable.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {StrategyManagerStorage} from "./abstract/StrategyManagerStorage.sol";
import {ICall} from './interfaces/ICall.sol';
import {IBeefyVaultV7} from './interfaces/IBeefyVaultV7.sol';
import {SubscriptionManager} from "./SubscriptionManager.sol";
import {ZapManager} from './zap/ZapManager.sol';
import {LiquidityManager} from './LiquidityManager.sol';
import {VaultManager} from "./VaultManager.sol";
import {DollarCostAverage} from './DollarCostAverage.sol';
import {InvestLib} from "./libraries/InvestLib.sol";
import {ZapLib} from "./libraries/ZapLib.sol";
import {StrategyFunding} from "./abstract/StrategyFunding.sol";

contract StrategyManager is StrategyManagerStorage, HubOwnable, ICall {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct Position {
        uint strategyId;
        bool closed;
    }

    struct InitializeParams {
        address owner;
        address treasury;
        address investLib;
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
        InvestLib.DcaInvestment[] dcaInvestments;
        InvestLib.VaultInvestment[] vaultInvestments;
        InvestLib.LiquidityInvestment[] liquidityInvestments;
        InvestLib.BuyInvestment[] buyInvestments;
        SubscriptionManager.Permit permit;
        bytes32 metadataHash;
    }

    /**
     * @dev swaps bytes are the encoded versions of ZapManager.ProtocolCall used in the callProtocol function
     */
    struct InvestParams {
        uint strategyId;
        IERC20Upgradeable inputToken;
        uint inputAmount;
        bytes inputTokenSwap;
        bytes[] dcaSwaps;
        bytes[] vaultSwaps;
        bytes[] buySwaps;
        InvestLib.LiquidityInvestZapParams[] liquidityZaps;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
    }

    struct InvestInProductParams {
        uint strategyId;
        uint amount;
        bytes[] swaps;
    }


    mapping(uint => InvestLib.DcaInvestment[]) internal _dcaInvestmentsPerStrategy;
    mapping(uint => InvestLib.VaultInvestment[]) internal _vaultInvestmentsPerStrategy;
    mapping(uint => InvestLib.LiquidityInvestment[]) internal _liquidityInvestmentsPerStrategy;
    mapping(uint => InvestLib.BuyInvestment[]) internal _buyInvestmentsPerStrategy;

    mapping(address => Position[]) internal _positions;
    // @dev investor => strategy position id => dca position ids
    mapping(address => mapping(uint => uint[])) internal _dcaPositionsPerPosition;
    // @dev investor => strategy position id => vault positions
    mapping(address => mapping(uint => InvestLib.VaultPosition[])) internal _vaultPositionsPerPosition;
    // @dev investor => strategy position id => liquidity positions
    mapping(address => mapping(uint => InvestLib.LiquidityPosition[])) internal _liquidityPositionsPerPosition;
    // @dev investor => strategy position id => buy positions
    mapping(address => mapping(uint => InvestLib.BuyPosition[])) internal _buyPositionsPerPosition;

    address public investLib;

    mapping(uint => bool) internal _hottestStrategiesMapping;
    uint[] internal _hottestStrategiesArray;
    uint8 public maxHottestStrategies;

    event StrategyCreated(address strategist, uint strategyId, bytes32 metadataHash);
    event PositionCreated(
        address user,
        uint strategyId,
        uint positionId,
        address inputToken,
        uint inputTokenAmount,
        uint stableAmountAfterFees,
        uint[] dcaPositionIds,
        InvestLib.VaultPosition[] vaultPositions,
        InvestLib.LiquidityPosition[] liquidityPositions,
        InvestLib.BuyPosition[] tokenPositions
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
    error StrategyUnavailable();
    error PositionAlreadyClosed();
    error InvalidPositionId(address investor, uint positionId);

    function initialize(InitializeParams calldata _initializeParams) external initializer {
        __Ownable_init();

        setMaxHottestStrategies(_initializeParams.maxHottestStrategies);
        setStrategistPercentage(_initializeParams.strategistPercentage);
        setHotStrategistPercentage(_initializeParams.hotStrategistPercentage);
        setTreasury(_initializeParams.treasury);

        transferOwnership(_initializeParams.owner);

        zapManager = _initializeParams.zapManager;
        investLib = _initializeParams.investLib;
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
            InvestLib.DcaInvestment memory dcaStrategy = _params.dcaInvestments[i];

            if (dcaStrategy.poolId >= dca.getPoolsLength())
                revert DollarCostAverage.InvalidPoolId();

            if (dcaStrategy.swaps == 0)
                revert DollarCostAverage.InvalidNumberOfSwaps();

            _dcaInvestmentsPerStrategy[strategyId].push(dcaStrategy);
        }

        for (uint i; i < _params.vaultInvestments.length; ++i) {
            InvestLib.VaultInvestment memory vaultStrategy = _params.vaultInvestments[i];

            _vaultInvestmentsPerStrategy[strategyId].push(vaultStrategy);
        }

        for (uint i; i < _params.liquidityInvestments.length; ++i) {
            InvestLib.LiquidityInvestment memory liquidityStrategy = _params.liquidityInvestments[i];

            if (liquidityStrategy.token0 >= liquidityStrategy.token1)
                revert InvalidInvestment();

            _liquidityInvestmentsPerStrategy[strategyId].push(liquidityStrategy);
        }

        for (uint i; i < _params.buyInvestments.length; ++i)
            _buyInvestmentsPerStrategy[strategyId].push(_params.buyInvestments[i]);

        emit StrategyCreated(msg.sender, strategyId, _params.metadataHash);
    }

    function invest(InvestParams calldata _params) external virtual {
        if (_params.strategyId > _strategies.length)
            revert StrategyUnavailable();

        Strategy storage strategy = _strategies[_params.strategyId];

        StrategyFunding.PullFundsResult memory pullFundsResult = abi.decode(
            _makeDelegateCall(
                address(this), // todo set correct address
                abi.encodeWithSelector(
                    StrategyFunding.pullFunds.selector,
                    StrategyFunding.PullFundsParams({
                        strategyId: _params.strategyId,
                        isHot: isHot(_params.strategyId),
                        inputToken: _params.inputToken,
                        inputAmount: _params.inputAmount,
                        inputTokenSwap: _params.inputTokenSwap,
                        investorPermit: _params.investorPermit,
                        strategistPermit: _params.strategistPermit
                    })
                )
            ),
            (StrategyFunding.PullFundsResult)
        );

        (
            uint[] memory dcaPositionIds,
            InvestLib.VaultPosition[] memory vaultPositions,
            InvestLib.LiquidityPosition[] memory liquidityPositions,
            InvestLib.BuyPosition[] memory buyPositions
        ) = abi.decode(
            _makeDelegateCall(
                address(investLib),
                abi.encodeWithSelector(
                    InvestLib.invest.selector,
                    InvestLib.InvestParams({
                        treasury: treasury,
                        dca: dca,
                        vaultManager: vaultManager,
                        liquidityManager: liquidityManager,
                        zapManager: zapManager,
                        inputToken: stable,
                        amount: pullFundsResult.remainingAmount,
                    // dca
                        dcaInvestments: _dcaInvestmentsPerStrategy[_params.strategyId],
                        dcaSwaps: _params.dcaSwaps,
                    // vaults
                        vaultInvestments: _vaultInvestmentsPerStrategy[_params.strategyId],
                        vaultSwaps: _params.vaultSwaps,
                    // liquidity
                        liquidityInvestments: _liquidityInvestmentsPerStrategy[_params.strategyId],
                        liquidityZaps: _params.liquidityZaps,
                        liquidityTotalPercentage: strategy.percentages[PRODUCT_LIQUIDITY],
                    // buy
                        buyInvestments: _buyInvestmentsPerStrategy[_params.strategyId],
                        buySwaps: _params.buySwaps
                    })
                )
            ),
            (uint[], InvestLib.VaultPosition[], InvestLib.LiquidityPosition[], InvestLib.BuyPosition[])
        );

        uint positionId = _positions[msg.sender].length;

        Position storage position = _positions[msg.sender].push();

        position.strategyId = _params.strategyId;
        _dcaPositionsPerPosition[msg.sender][positionId] = dcaPositionIds;

        for (uint i; i < vaultPositions.length; ++i)
            _vaultPositionsPerPosition[msg.sender][positionId].push(vaultPositions[i]);

        for (uint i; i < liquidityPositions.length; ++i)
            _liquidityPositionsPerPosition[msg.sender][positionId].push(liquidityPositions[i]);

        for (uint i; i < buyPositions.length; ++i)
            _buyPositionsPerPosition[msg.sender][positionId].push(buyPositions[i]);

        emit PositionCreated(
            msg.sender,
            _params.strategyId,
            positionId,
            address(_params.inputToken),
            _params.inputAmount,
            pullFundsResult.remainingAmount,
            dcaPositionIds,
            vaultPositions,
            liquidityPositions,
            buyPositions
        );
    }

    function closePosition(
        uint _positionId,
        InvestLib.LiquidityMinOutputs[] calldata _liquidityMinOutputs
    ) external virtual {
        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        position.closed = true;

        (
            uint[][] memory dcaWithdrawnAmounts,
            uint[] memory vaultWithdrawnAmounts,
            uint[][] memory liquidityWithdrawnAmounts,
            uint[] memory buyWithdrawnAmounts
        ) = abi.decode(
            _makeDelegateCall(
                address(investLib),
                abi.encodeWithSelector(
                    InvestLib.closePosition.selector,
                    InvestLib.ClosePositionParams({
                        dca: dca,
                        dcaPositions: _dcaPositionsPerPosition[msg.sender][_positionId],
                        vaultPositions: _vaultPositionsPerPosition[msg.sender][_positionId],
                        liquidityPositions: _liquidityPositionsPerPosition[msg.sender][_positionId],
                        liquidityMinOutputs: _liquidityMinOutputs,
                        buyPositions: _buyPositionsPerPosition[msg.sender][_positionId]
                    })
                )
            ),
            (uint[][], uint[], uint[][], uint[])
        );

        emit PositionClosed(
            msg.sender,
            position.strategyId,
            _positionId,
            dcaWithdrawnAmounts,
            vaultWithdrawnAmounts,
            liquidityWithdrawnAmounts,
            buyWithdrawnAmounts
        );
    }

    function collectPosition(uint _positionId) external virtual {
        if (_positionId >= _positions[msg.sender].length)
            revert InvalidPositionId(msg.sender, _positionId);

        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        InvestLib.BuyPosition[] memory buyPositions = _buyPositionsPerPosition[msg.sender][_positionId];

        // TODO test delete functionality and also test if can use storage with delete to save gas
        if (buyPositions.length > 0)
            delete _buyPositionsPerPosition[msg.sender][_positionId];

        (
            uint[] memory dcaWithdrawnAmounts,
            uint[][] memory liquidityWithdrawnAmounts,
            uint[] memory buyWithdrawnAmounts
        ) = abi.decode(
            _makeDelegateCall(
                address(investLib),
                abi.encodeWithSelector(
                    InvestLib.collectPosition.selector,
                    InvestLib.CollectPositionParams({
                        dca: dca,
                        dcaPositions: _dcaPositionsPerPosition[msg.sender][_positionId],
                        liquidityPositions: _liquidityPositionsPerPosition[msg.sender][_positionId],
                        buyPositions: buyPositions
                    })
                )
            ),
            (uint[], uint[][], uint[])
        );

        emit PositionCollected(
            msg.sender,
            position.strategyId,
            _positionId,
            dcaWithdrawnAmounts,
            liquidityWithdrawnAmounts,
            buyWithdrawnAmounts
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
        InvestLib.VaultPosition[] memory vaultPositions,
        InvestLib.LiquidityPosition[] memory liquidityPositions,
        InvestLib.BuyPosition[] memory buyPositions
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
        InvestLib.DcaInvestment[] memory dcaInvestments,
        InvestLib.VaultInvestment[] memory vaultInvestments,
        InvestLib.LiquidityInvestment[] memory liquidityInvestments,
        InvestLib.BuyInvestment[] memory buyInvestments
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

    function isHot(uint _strategyId) public virtual view returns (bool) {
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
        (bool success, bytes memory resultData) = investLib.delegatecall(_callData);

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
