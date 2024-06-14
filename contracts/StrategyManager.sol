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
    }

    struct InitializeParams {
        address owner;
        address treasury;
        address investmentLib;
        IERC20Upgradeable stable;
        SubscriptionManager subscriptionManager;
        DollarCostAverage dca;
        VaultManager vaultManager;
        LiquidityManager liquidityManager;
        ZapManager zapManager;
        uint8 maxHottestStrategies;
        uint32 strategistPercentage;
        uint32 hotStrategistPercentage;
    }

    struct CreateStrategyParams {
        InvestLib.DcaInvestment[] dcaInvestments;
        InvestLib.VaultInvestment[] vaultInvestments;
        InvestLib.LiquidityInvestment[] liquidityInvestments;
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
        InvestLib.LiquidityZapParams[] liquidityZaps;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
    }

    struct InvestInProductParams {
        uint strategyId;
        uint amount;
        bytes[] swaps;
    }

    struct PullFundsParams {
        address strategist;
        uint strategyId;
        IERC20Upgradeable inputToken;
        uint inputAmount;
        bytes inputTokenSwap;
        SubscriptionManager.Permit permit;
    }

    struct PullFundsResult {
        uint remainingAmount;
        uint strategistFee;
    }

    uint8 public constant PRODUCT_DCA = 0;
    uint8 public constant PRODUCT_VAULTS = 1;
    uint8 public constant PRODUCT_LIQUIDITY = 2;

    mapping(address => uint) internal _strategistRewards;

    Strategy[] internal _strategies;
    mapping(uint => InvestLib.DcaInvestment[]) internal _dcaInvestmentsPerStrategy;
    mapping(uint => InvestLib.VaultInvestment[]) internal _vaultInvestmentsPerStrategy;
    mapping(uint => InvestLib.LiquidityInvestment[]) internal _liquidityInvestmentsPerStrategy;

    mapping(address => Position[]) internal _positions;
    // @dev investor => strategy position id => dca position ids
    mapping(address => mapping(uint => uint[])) internal _dcaPositionsPerPosition;
    // @dev investor => strategy position id => vault positions
    mapping(address => mapping(uint => InvestLib.VaultPosition[])) internal _vaultPositionsPerPosition;
    // @dev investor => strategy position id => liquidity positions
    mapping(address => mapping(uint => InvestLib.LiquidityPosition[])) internal _liquidityPositionsPerPosition;

    address public investmentLib;
    IERC20Upgradeable public stable;
    ZapManager public zapManager;
    SubscriptionManager public subscriptionManager;
    DollarCostAverage public dca;
    VaultManager public vaultManager;
    LiquidityManager public liquidityManager;

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
        InvestLib.VaultPosition[] vaultPositions
    );
    event PositionClosed(
        address owner,
        uint strategyId,
        uint positionId,
        uint[][] dcaWithdrawnAmounts,
        uint[] vaultWithdrawnAmount,
        uint[][] liquidityWithdrawnAmounts
    );
    event PositionCollected(
        address owner,
        uint strategyId,
        uint positionId,
        uint[] dcaWithdrawnAmounts,
        uint[][] liquidityWithdrawnAmounts
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
        investmentLib = _initializeParams.investmentLib;
        stable = _initializeParams.stable;
        subscriptionManager = _initializeParams.subscriptionManager;
        dca = _initializeParams.dca;
        vaultManager = _initializeParams.vaultManager;
        liquidityManager = _initializeParams.liquidityManager;
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

        for (uint i; i < _params.dcaInvestments.length; ++i)
            dcaPercentage += _params.dcaInvestments[i].percentage;

        for (uint i; i < _params.vaultInvestments.length; ++i)
            vaultPercentage += _params.vaultInvestments[i].percentage;

        for (uint i = 0; i < _params.liquidityInvestments.length; i++)
            liquidityPercentage += _params.liquidityInvestments[i].percentage;

        if ((dcaPercentage + vaultPercentage + liquidityPercentage) != 100)
            revert InvalidTotalPercentage();

        uint strategyId = _strategies.length;

        Strategy storage strategy = _strategies.push();
        strategy.creator = msg.sender;
        strategy.percentages[PRODUCT_DCA] = dcaPercentage;
        strategy.percentages[PRODUCT_VAULTS] = vaultPercentage;
        strategy.percentages[PRODUCT_LIQUIDITY] = liquidityPercentage;

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

        emit StrategyCreated(msg.sender, strategyId, _params.metadataHash);
    }

    function invest(InvestParams calldata _params) external virtual {
        if (_params.strategyId > _strategies.length)
            revert StrategyUnavailable();

        Strategy storage strategy = _strategies[_params.strategyId];
        address strategist = subscriptionManager.isSubscribed(strategy.creator, _params.strategistPermit)
            ? strategy.creator
            : address(0);

        // max approve is safe since zapManager is a trusted contract
        if (_params.inputToken.allowance(address(this), address(zapManager)) < _params.inputAmount)
            _params.inputToken.approve(address(zapManager), type(uint256).max);

        PullFundsResult memory pullFundsResult = _pullFunds(
            PullFundsParams({
                strategist: strategist,
                strategyId: _params.strategyId,
                inputToken: _params.inputToken,
                inputAmount: _params.inputAmount,
                inputTokenSwap: _params.inputTokenSwap,
                permit: _params.investorPermit
            })
        );

        // max approve is safe since zapManager is a trusted contract
        if (stable.allowance(address(this), address(zapManager)) < pullFundsResult.remainingAmount)
            stable.approve(address(zapManager), type(uint256).max);

        (
            uint[] memory dcaPositionIds,
            InvestLib.VaultPosition[] memory vaultPositions,
            InvestLib.LiquidityPosition[] memory liquidityPositions
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
                        liquidityZaps: _params.liquidityZaps
                    })
                )
            ),
            (uint[], InvestLib.VaultPosition[], InvestLib.LiquidityPosition[])
        );

        uint positionId = _positions[msg.sender].length;

        Position storage position = _positions[msg.sender].push();

        position.strategyId = _params.strategyId;
        _dcaPositionsPerPosition[msg.sender][positionId] = dcaPositionIds;

        for (uint i; i < vaultPositions.length; ++i)
            _vaultPositionsPerPosition[msg.sender][positionId].push(vaultPositions[i]);

        for (uint i; i < liquidityPositions.length; ++i)
            _liquidityPositionsPerPosition[msg.sender][positionId].push(liquidityPositions[i]);

        emit PositionCreated(
            msg.sender,
            _params.strategyId,
            positionId,
            address(_params.inputToken),
            _params.inputAmount,
            pullFundsResult.remainingAmount,
            dcaPositionIds,
            vaultPositions
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
            uint[][] memory liquidityWithdrawnAmounts
        ) = abi.decode(
            _callInvestLib(
                abi.encodeWithSelector(
                    InvestLib.closePosition.selector,
                    InvestLib.ClosePositionParams({
                        dca: dca,
                        dcaPositions: _dcaPositionsPerPosition[msg.sender][_positionId],
                        vaultPositions: _vaultPositionsPerPosition[msg.sender][_positionId],
                        liquidityPositions: _liquidityPositionsPerPosition[msg.sender][_positionId],
                        liquidityMinOutputs: _liquidityMinOutputs
                    })
                )
            ),
            (uint[][], uint[], uint[][])
        );

        emit PositionClosed(
            msg.sender,
            position.strategyId,
            _positionId,
            dcaWithdrawnAmounts,
            vaultWithdrawnAmounts,
            liquidityWithdrawnAmounts
        );
    }

    function collectPosition(uint _positionId) external virtual {
        if (_positionId >= _positions[msg.sender].length)
            revert InvalidPositionId(msg.sender, _positionId);

        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        (
            uint[] memory dcaWithdrawnAmounts,
            uint[][] memory liquidityWithdrawnAmounts
        ) = abi.decode(
            _callInvestLib(
                abi.encodeWithSelector(
                    InvestLib.collectPosition.selector,
                    InvestLib.CollectPositionParams({
                        dca: dca,
                        dcaPositions: _dcaPositionsPerPosition[msg.sender][_positionId],
                        liquidityPositions: _liquidityPositionsPerPosition[msg.sender][_positionId]
                    })
                )
            ),
            (uint[], uint[][])
        );

        emit PositionCollected(
            msg.sender,
            position.strategyId,
            _positionId,
            dcaWithdrawnAmounts,
            liquidityWithdrawnAmounts
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
        InvestLib.VaultInvestment[] memory vaultInvestments
    ) {
        return (_dcaInvestmentsPerStrategy[_strategyId], _vaultInvestmentsPerStrategy[_strategyId]);
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

    function calculateFee(
        uint _strategyId,
        address _product,
        uint _amount,
        address _investor,
        address _strategist,
        SubscriptionManager.Permit calldata _investorPermit,
        SubscriptionManager.Permit calldata _strategistPermit
    ) external view returns (uint protocolFee, uint strategistFee) {
        uint currentStrategistPercentage = isHot(_strategyId)
            ? hotStrategistPercentage
            : strategistPercentage;

        address strategist = subscriptionManager.isSubscribed(_strategist, _strategistPermit)
            ? _strategist
            : address(0);

        (protocolFee, strategistFee) = _calculateProductFee(
            _product,
            _investor,
            strategist,
            _amount,
            currentStrategistPercentage,
            _investorPermit
        );
    }

    /**
     * ----- Internal functions -----
     */

    function _callInvestLib(
        bytes memory _callData
    ) internal returns (
        bytes memory
    ) {
        (bool success, bytes memory resultData) = investmentLib.delegatecall(_callData);

        if (!success)
            revert LowLevelCallFailed(address(investmentLib), "", resultData);

        return resultData;
    }

    function _pullFunds(
        PullFundsParams memory _params
    ) internal virtual returns (
        PullFundsResult memory
    ) {
        Strategy storage strategy = _strategies[_params.strategyId];

        uint currentStrategistPercentage = isHot(_params.strategyId)
            ? hotStrategistPercentage
            : strategistPercentage;
        uint initialInputTokenBalance = _params.inputToken.balanceOf(address(this));

        _params.inputToken.safeTransferFrom(msg.sender, address(this), _params.inputAmount);

        // Convert to stable if input token is not stable and set amount in stable terms
        uint stableAmount = _params.inputToken == stable
            ? _params.inputToken.balanceOf(address(this)) - initialInputTokenBalance
            : zapManager.zap(
                _params.inputTokenSwap,
                _params.inputToken,
                stable,
                _params.inputToken.balanceOf(address(this)) - initialInputTokenBalance
            );

        uint protocolFee;
        uint strategistFee;

        if (strategy.percentages[PRODUCT_DCA] > 0) {
            (uint _protocolFee, uint _strategistFee) = _calculateProductFee(
                address(dca),
                msg.sender,
                _params.strategist,
                stableAmount * strategy.percentages[PRODUCT_DCA] / 100,
                currentStrategistPercentage,
                _params.permit
            );

            protocolFee += _protocolFee;
            strategistFee += _strategistFee;
        }

        if (strategy.percentages[PRODUCT_VAULTS] > 0) {
            (uint _protocolFee, uint _strategistFee) = _calculateProductFee(
                address(vaultManager),
                msg.sender,
                _params.strategist,
                stableAmount * strategy.percentages[PRODUCT_VAULTS] / 100,
                currentStrategistPercentage,
                _params.permit
            );

            protocolFee += _protocolFee;
            strategistFee += _strategistFee;
        }

        if (strategy.percentages[PRODUCT_LIQUIDITY] > 0) {
            (uint _protocolFee, uint _strategistFee) = _calculateProductFee(
                address(liquidityManager),
                msg.sender,
                _params.strategist,
                stableAmount * strategy.percentages[PRODUCT_LIQUIDITY] / 100,
                currentStrategistPercentage,
                _params.permit
            );

            protocolFee += _protocolFee;
            strategistFee += _strategistFee;
        }

        stable.safeTransfer(treasury, protocolFee);

        if (strategistFee > 0) {
            _strategistRewards[_params.strategist] += strategistFee;

            emit UseFee.Fee(msg.sender, _params.strategist, strategistFee, abi.encode(_params.strategyId));
        }

        emit UseFee.Fee(msg.sender, treasury, protocolFee, abi.encode(_params.strategyId));

        return PullFundsResult(
            stableAmount - (protocolFee + strategistFee),
            strategistFee
        );
    }

    /**
     * @dev Takes the base fee of a product and splits it between the protocol and strategist fees by applying the current strategist percentage.
     *
     * @param _product The product to calculate the fee for
     * @param _investor The user that is paying the fee
     * @param _strategist The strategist that created the strategy
     * @param _amount The amount being deposited into the product
     * @param _currentStrategistPercentage Percentage based on the strategy being one of the hottest deals
     * @param _permit The permit to check if the user is subscribed
     *
     * @return protocolFee The fee that goes to the protocol
     * @return strategistFee The fee that goes to the strategy creator
     **/
    function _calculateProductFee(
        address _product,
        address _investor,
        address _strategist,
        uint _amount,
        uint _currentStrategistPercentage,
        SubscriptionManager.Permit memory _permit
    ) internal virtual view returns (
        uint protocolFee,
        uint strategistFee
    ) {
        (uint baseFee, uint nonSubscriberFee) = UseFee(_product).calculateFee(
            _investor,
            _amount,
            _permit
        );

        strategistFee = _strategist != address(0)
            ? baseFee * _currentStrategistPercentage / 100
            : 0;
        protocolFee = baseFee - strategistFee + nonSubscriberFee;
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
