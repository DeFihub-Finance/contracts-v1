// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

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
import {InvestLib} from "./libraries/InvestLib.sol";
import {ZapLib} from "./libraries/ZapLib.sol";
import {StrategyPositionManager} from "./abstract/StrategyPositionManager.sol";

contract StrategyManager is StrategyStorage, HubOwnable, ICall {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct InitializeParams {
        address owner;
        address treasury;
        address investLib;
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

    address public investLib;
    address public strategyPositionManager;

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
        StrategyStorage.VaultPosition[] vaultPositions,
        StrategyStorage.LiquidityPosition[] liquidityPositions,
        StrategyStorage.BuyPosition[] tokenPositions
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
            StrategyStorage.VaultPosition[] memory vaultPositions,
            StrategyStorage.LiquidityPosition[] memory liquidityPositions,
            StrategyStorage.BuyPosition[] memory buyPositions
        ) = abi.decode(
            _makeDelegateCall(
                investLib,
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
            (uint[], StrategyStorage.VaultPosition[], StrategyStorage.LiquidityPosition[], StrategyStorage.BuyPosition[])
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
        StrategyPositionManager.LiquidityMinOutputs[] calldata _liquidityMinOutputs
    ) external virtual {
        _makeDelegateCall(
            strategyPositionManager,
            abi.encodeWithSelector(StrategyPositionManager.closePosition.selector, _positionId, _liquidityMinOutputs)
        );
    }

    function collectPosition(uint _positionId) external virtual {
        if (_positionId >= _positions[msg.sender].length)
            revert InvalidPositionId(msg.sender, _positionId);

        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        StrategyStorage.BuyPosition[] memory buyPositions = _buyPositionsPerPosition[msg.sender][_positionId];

        // TODO test delete functionality and also test if can use storage with delete to save gas
        if (buyPositions.length > 0)
            delete _buyPositionsPerPosition[msg.sender][_positionId];

        (
            uint[] memory dcaWithdrawnAmounts,
            uint[][] memory liquidityWithdrawnAmounts,
            uint[] memory buyWithdrawnAmounts
        ) = abi.decode(
            _makeDelegateCall(
                strategyPositionManager,
                abi.encodeWithSelector(
                    StrategyPositionManager.collectPosition.selector,
                    StrategyPositionManager.CollectPositionParams({
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
        (bool success, bytes memory resultData) = _target.delegatecall(_callData);

        if (!success)
            revert LowLevelCallFailed(_target, "", resultData);

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

        uint stableAmount = ZapLib.zap(
            zapManager,
            _params.inputTokenSwap,
            _params.inputToken,
            stable,
            _params.inputToken.balanceOf(address(this)) - initialInputTokenBalance
        );

        // Divided by multiplier 10_000 (fee percentage) * 100 (strategy percentage per investment) = 1M
        uint totalFee = stableAmount * (
            _getProductFee(strategy.percentages[PRODUCT_DCA], dca, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_VAULTS], vaultManager, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_LIQUIDITY], liquidityManager, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_BUY], buyProduct, userSubscribed)
        ) / 1_000_000;
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

    function _getProductFee(
        uint8 _productPercentage,
        UseFee _product,
        bool _userSubscribed
    ) internal view returns (uint32) {
        if (_productPercentage == 0)
            return 0;

        return _product.getFeePercentage(_userSubscribed) * _productPercentage;
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
