// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {HubOwnable} from "./abstract/HubOwnable.sol";
import {UseTreasury} from "./abstract/UseTreasury.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {ICall} from './interfaces/ICall.sol';
import {IBeefyVaultV7} from './interfaces/IBeefyVaultV7.sol';
import {ZapManager} from './zap/ZapManager.sol';
import {SubscriptionManager} from "./SubscriptionManager.sol";
import {VaultManager} from "./VaultManager.sol";
import {DollarCostAverage} from './DollarCostAverage.sol';
import {InvestLib} from "./libraries/InvestLib.sol";
import {ZapLib} from "./libraries/ZapLib.sol";
import {LiquidityManager} from './LiquidityManager.sol';

contract StrategyManager is HubOwnable, UseTreasury, ICall {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // @notice percentages is a mapping from product id to its percentage
    struct Strategy {
        address creator;
        mapping(uint8 => uint8) percentages;
    }

    struct Position {
        uint strategyId;
        bool closed;
        bool collected;
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
        UseFee exchangeManager;
        ZapManager zapManager;
        uint8 maxHottestStrategies;
        uint32 strategistPercentage;
        uint32 hotStrategistPercentage;
    }

    struct CreateStrategyParams {
        InvestLib.DcaInvestment[] dcaInvestments;
        InvestLib.VaultInvestment[] vaultInvestments;
        InvestLib.LiquidityInvestment[] liquidityInvestments;
        InvestLib.TokenInvestment[] tokenInvestments;
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
        bytes[] tokenSwaps;
        InvestLib.LiquidityInvestZapParams[] liquidityZaps;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
    }

    struct InvestInProductParams {
        uint strategyId;
        uint amount;
        bytes[] swaps;
    }

    struct PullFundsParams {
        uint strategyId;
        IERC20Upgradeable inputToken;
        uint inputAmount;
        bytes inputTokenSwap;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
    }

    struct PullFundsResult {
        uint remainingAmount;
        uint strategistFee;
    }

    uint8 public constant PRODUCT_DCA = 0;
    uint8 public constant PRODUCT_VAULTS = 1;
    uint8 public constant PRODUCT_LIQUIDITY = 2;
    uint8 public constant PRODUCT_TOKENS = 3;

    mapping(address => uint) internal _strategistRewards;

    Strategy[] internal _strategies;
    mapping(uint => InvestLib.DcaInvestment[]) internal _dcaInvestmentsPerStrategy;
    mapping(uint => InvestLib.VaultInvestment[]) internal _vaultInvestmentsPerStrategy;
    mapping(uint => InvestLib.LiquidityInvestment[]) internal _liquidityInvestmentsPerStrategy;
    mapping(uint => InvestLib.TokenInvestment[]) internal _tokenInvestmentsPerStrategy;

    mapping(address => Position[]) internal _positions;
    // @dev investor => strategy position id => dca position ids
    mapping(address => mapping(uint => uint[])) internal _dcaPositionsPerPosition;
    // @dev investor => strategy position id => vault positions
    mapping(address => mapping(uint => InvestLib.VaultPosition[])) internal _vaultPositionsPerPosition;
    // @dev investor => strategy position id => liquidity positions
    mapping(address => mapping(uint => InvestLib.LiquidityPosition[])) internal _liquidityPositionsPerPosition;
    // @dev investor => strategy position id => liquidity positions
    mapping(address => mapping(uint => InvestLib.TokenPosition[])) internal _tokenPositionsPerPosition;

    address public investLib;
    IERC20Upgradeable public stable;
    ZapManager public zapManager;
    SubscriptionManager public subscriptionManager;
    DollarCostAverage public dca;
    VaultManager public vaultManager;
    LiquidityManager public liquidityManager;
    UseFee public exchangeManager;

    mapping(uint => bool) internal _hottestStrategiesMapping;
    uint[] internal _hottestStrategiesArray;
    uint8 public maxHottestStrategies;

    uint32 public strategistPercentage;
    uint32 public hotStrategistPercentage;

    event StrategyCreated(address creator, uint strategyId, bytes32 metadataHash);
    event PositionCreated(
        address owner,
        uint strategyId,
        uint positionId,
        address inputToken,
        uint inputTokenAmount,
        uint stableAmountAfterFees,
        uint[] dcaPositionIds,
        InvestLib.VaultPosition[] vaultPositions,
        InvestLib.LiquidityPosition[] liquidityPositions,
        InvestLib.TokenPosition[] tokenPositions
    );
    event PositionClosed(
        address owner,
        uint strategyId,
        uint positionId,
        uint[][] dcaWithdrawnAmounts,
        uint[] vaultWithdrawnAmount,
        uint[][] liquidityWithdrawnAmounts,
        uint[] tokenWithdrawnAmounts
    );
    event PositionCollected(
        address owner,
        uint strategyId,
        uint positionId,
        uint[] dcaWithdrawnAmounts,
        uint[][] liquidityWithdrawnAmounts,
        uint[] tokenWithdrawnAmounts
    );
    event CollectedStrategistRewards(address strategist, uint amount);
    event StrategistPercentageUpdated(uint32 discountPercentage);
    event HotStrategistPercentageUpdated(uint32 discountPercentage);
    event HottestStrategiesUpdated(uint[] strategies);
    event MaxHotStrategiesUpdated(uint8 max);

    error Unauthorized();
    error TooManyInvestments();
    error TooManyUsers();
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
        exchangeManager = _initializeParams.exchangeManager;
    }

    function createStrategy(CreateStrategyParams memory _params) external virtual {
        uint investmentCount = _params.dcaInvestments.length + _params.vaultInvestments.length;

        if (!subscriptionManager.isSubscribed(msg.sender, _params.permit))
            revert Unauthorized();

        if (investmentCount > 20)
            revert TooManyInvestments();

        uint8 dcaPercentage;
        uint8 vaultPercentage;
        uint8 liquidityPercentage;
        uint8 tokenPercentage;

        for (uint i; i < _params.dcaInvestments.length; ++i)
            dcaPercentage += _params.dcaInvestments[i].percentage;

        for (uint i; i < _params.vaultInvestments.length; ++i)
            vaultPercentage += _params.vaultInvestments[i].percentage;

        for (uint i = 0; i < _params.liquidityInvestments.length; i++)
            liquidityPercentage += _params.liquidityInvestments[i].percentage;

        for (uint i = 0; i < _params.tokenInvestments.length; i++)
            tokenPercentage += _params.tokenInvestments[i].percentage;

        if (dcaPercentage + vaultPercentage + liquidityPercentage + tokenPercentage != 100)
            revert InvalidTotalPercentage();

        uint strategyId = _strategies.length;

        Strategy storage strategy = _strategies.push();
        strategy.creator = msg.sender;
        strategy.percentages[PRODUCT_DCA] = dcaPercentage;
        strategy.percentages[PRODUCT_VAULTS] = vaultPercentage;
        strategy.percentages[PRODUCT_LIQUIDITY] = liquidityPercentage;
        strategy.percentages[PRODUCT_TOKENS] = tokenPercentage;

        // Assigning isn't possible because you can't convert an array of structs from memory to storage
        for (uint i; i < _params.dcaInvestments.length; ++i) {
            InvestLib.DcaInvestment memory dcaStrategy = _params.dcaInvestments[i];

            if (dcaStrategy.poolId >= dca.getPoolsLength())
                revert InvalidInvestment();

            _dcaInvestmentsPerStrategy[strategyId].push(dcaStrategy);
        }

        for (uint i; i < _params.vaultInvestments.length; ++i) {
            InvestLib.VaultInvestment memory vaultStrategy = _params.vaultInvestments[i];

            if (!vaultManager.whitelistedVaults(vaultStrategy.vault))
                revert InvalidInvestment();

            _vaultInvestmentsPerStrategy[strategyId].push(vaultStrategy);
        }

        for (uint i = 0; i < _params.liquidityInvestments.length; i++) {
            InvestLib.LiquidityInvestment memory liquidityStrategy = _params.liquidityInvestments[i];

            if (
                !liquidityManager.positionManagerWhitelist(liquidityStrategy.positionManager) ||
            liquidityStrategy.token0 > liquidityStrategy.token1
            )
                revert InvalidInvestment();

            _liquidityInvestmentsPerStrategy[strategyId].push(liquidityStrategy);
        }

        for (uint i = 0; i < _params.tokenInvestments.length; i++)
            _tokenInvestmentsPerStrategy[strategyId].push(_params.tokenInvestments[i]);

        emit StrategyCreated(msg.sender, strategyId, _params.metadataHash);
    }

    function invest(InvestParams calldata _params) external virtual {
        if (_params.strategyId > _strategies.length)
            revert StrategyUnavailable();

        Strategy storage strategy = _strategies[_params.strategyId];

        PullFundsResult memory pullFundsResult = _pullFunds(
            PullFundsParams({
                strategyId: _params.strategyId,
                inputToken: _params.inputToken,
                inputAmount: _params.inputAmount,
                inputTokenSwap: _params.inputTokenSwap,
                investorPermit: _params.investorPermit,
                strategistPermit: _params.strategistPermit
            })
        );

        (
            uint[] memory dcaPositionIds,
            InvestLib.VaultPosition[] memory vaultPositions,
            InvestLib.LiquidityPosition[] memory liquidityPositions,
            InvestLib.TokenPosition[] memory tokenPositions
        ) = abi.decode(
            _callInvestLib(
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
                    // token
                        tokenInvestments: _tokenInvestmentsPerStrategy[_params.strategyId],
                        tokenSwaps: _params.tokenSwaps
                    })
                )
            ),
            (uint[], InvestLib.VaultPosition[], InvestLib.LiquidityPosition[], InvestLib.TokenPosition[])
        );

        uint positionId = _positions[msg.sender].length;

        Position storage position = _positions[msg.sender].push();

        position.strategyId = _params.strategyId;
        _dcaPositionsPerPosition[msg.sender][positionId] = dcaPositionIds;

        for (uint i; i < vaultPositions.length; ++i)
            _vaultPositionsPerPosition[msg.sender][positionId].push(vaultPositions[i]);

        for (uint i; i < liquidityPositions.length; ++i)
            _liquidityPositionsPerPosition[msg.sender][positionId].push(liquidityPositions[i]);

        for (uint i; i < tokenPositions.length; ++i)
            _tokenPositionsPerPosition[msg.sender][positionId].push(tokenPositions[i]);

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
            tokenPositions
        );
    }

    function closePosition(
        uint _positionId,
        InvestLib.LiquidityMinOutputs[] calldata _liquidityMinOutputs
    ) external virtual {
        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        InvestLib.TokenPosition[] memory tokenPositions = position.collected
            ? new InvestLib.TokenPosition[](0)
            : _tokenPositionsPerPosition[msg.sender][_positionId];

        position.closed = true;
        position.collected = true;

        (
            uint[][] memory dcaWithdrawnAmounts,
            uint[] memory vaultWithdrawnAmounts,
            uint[][] memory liquidityWithdrawnAmounts,
            uint[] memory tokenWithdrawnAmounts
        ) = abi.decode(
            _callInvestLib(
                abi.encodeWithSelector(
                    InvestLib.closePosition.selector,
                    InvestLib.ClosePositionParams({
                        dca: dca,
                        dcaPositions: _dcaPositionsPerPosition[msg.sender][_positionId],
                        vaultPositions: _vaultPositionsPerPosition[msg.sender][_positionId],
                        liquidityPositions: _liquidityPositionsPerPosition[msg.sender][_positionId],
                        liquidityMinOutputs: _liquidityMinOutputs,
                        tokenPositions: tokenPositions
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
            tokenWithdrawnAmounts
        );
    }

    function collectPosition(uint _positionId) external virtual {
        if (_positionId >= _positions[msg.sender].length)
            revert InvalidPositionId(msg.sender, _positionId);

        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        InvestLib.TokenPosition[] memory tokenPositions = position.collected
            ? new InvestLib.TokenPosition[](0)
            : _tokenPositionsPerPosition[msg.sender][_positionId];

        position.collected = true;

        (
            uint[] memory dcaWithdrawnAmounts,
            uint[][] memory liquidityWithdrawnAmounts,
            uint[] memory tokenWithdrawnAmounts
        ) = abi.decode(
            _callInvestLib(
                abi.encodeWithSelector(
                    InvestLib.collectPosition.selector,
                    InvestLib.CollectPositionParams({
                        dca: dca,
                        dcaPositions: _dcaPositionsPerPosition[msg.sender][_positionId],
                        liquidityPositions: _liquidityPositionsPerPosition[msg.sender][_positionId],
                        tokenPositions: tokenPositions
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
            tokenWithdrawnAmounts
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
        InvestLib.VaultPosition[] memory vaultPositions
    ) {
        return (
            _dcaPositionsPerPosition[_investor][_positionId],
            _vaultPositionsPerPosition[_investor][_positionId]
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
        InvestLib.TokenInvestment[] memory tokenInvestments
    ) {
        return (
            _dcaInvestmentsPerStrategy[_strategyId],
            _vaultInvestmentsPerStrategy[_strategyId],
            _liquidityInvestmentsPerStrategy[_strategyId],
            _tokenInvestmentsPerStrategy[_strategyId]
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

    function _callInvestLib(
        bytes memory _callData
    ) internal returns (
        bytes memory
    ) {
        (bool success, bytes memory resultData) = investLib.delegatecall(_callData);

        if (!success)
            revert LowLevelCallFailed(address(investLib), "", resultData);

        return resultData;
    }

    function _pullFunds(
        PullFundsParams memory _params
    ) internal virtual returns (
        PullFundsResult memory
    ) {
        Strategy storage strategy = _strategies[_params.strategyId];

        bool strategistSubscribed = subscriptionManager.isSubscribed(strategy.creator, _params.strategistPermit);
        bool userSubscribed = subscriptionManager.isSubscribed(msg.sender, _params.investorPermit);
        uint initialInputTokenBalance = _params.inputToken.balanceOf(address(this));

        _params.inputToken.safeTransferFrom(msg.sender, address(this), _params.inputAmount);

        uint inputTokenReceived = _params.inputToken.balanceOf(address(this)) - initialInputTokenBalance;
        uint stableAmount = ZapLib._zap(
            zapManager,
            _params.inputTokenSwap,
            _params.inputToken,
            stable,
            inputTokenReceived
        );

        uint totalFeePercentage;

        if (strategy.percentages[PRODUCT_DCA] > 0)
            totalFeePercentage = dca.getFeePercentage(userSubscribed) * strategy.percentages[PRODUCT_DCA];

        if (strategy.percentages[PRODUCT_VAULTS] > 0)
            totalFeePercentage += vaultManager.getFeePercentage(userSubscribed) * strategy.percentages[PRODUCT_VAULTS];

        if (strategy.percentages[PRODUCT_LIQUIDITY] > 0)
            totalFeePercentage += liquidityManager.getFeePercentage(userSubscribed) * strategy.percentages[PRODUCT_LIQUIDITY];

        if (strategy.percentages[PRODUCT_TOKENS] > 0)
            totalFeePercentage += exchangeManager.getFeePercentage(userSubscribed) * strategy.percentages[PRODUCT_TOKENS];

        // Divided by multiplier 10_000 (fee percentage) * 100 (strategy percentage per investment) = 1M
        uint totalFee = stableAmount * totalFeePercentage / 1_000_000;
        uint strategistFee;

        if (strategistSubscribed) {
            uint currentStrategistPercentage = isHot(_params.strategyId)
                ? hotStrategistPercentage
                : strategistPercentage;

            strategistFee = totalFee * currentStrategistPercentage / 100;
        }

        uint protocolFee = totalFee - strategistFee;

        stable.safeTransfer(treasury, protocolFee);

        if (strategistFee > 0) {
            _strategistRewards[strategy.creator] += strategistFee;

            emit UseFee.Fee(msg.sender, strategy.creator, strategistFee, abi.encode(_params.strategyId));
        }

        emit UseFee.Fee(msg.sender, treasury, protocolFee, abi.encode(_params.strategyId));

        return PullFundsResult(
            stableAmount - (protocolFee + strategistFee),
            strategistFee
        );
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
            revert TooManyUsers();

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
