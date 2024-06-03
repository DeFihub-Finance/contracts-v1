// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {HubOwnable} from "./abstract/HubOwnable.sol";
import {UseTreasury} from "./abstract/UseTreasury.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {IBeefyVaultV7} from './interfaces/IBeefyVaultV7.sol';
import {ICall} from './interfaces/ICall.sol';
import {ZapManager} from './zap/ZapManager.sol';
import {SubscriptionManager} from "./SubscriptionManager.sol";
import {VaultManager} from "./VaultManager.sol";
import {DollarCostAverage} from './DollarCostAverage.sol';

contract StrategyManager is HubOwnable, UseTreasury, ICall {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct DcaStrategy {
        uint208 poolId;
        uint16 swaps;
        uint8 percentage;
    }

    struct VaultStrategy {
        address vault;
        uint8 percentage;
    }

    struct Strategy {
        address creator;
        uint totalDeposits;
        uint8 dcaPercentage;
        uint8 vaultPercentage;
        DcaStrategy[] dcaInvestments;
        VaultStrategy[] vaultInvestments;
    }

    struct VaultPosition {
        address vault;
        uint amount;
    }

    struct Position {
        uint strategyId;
        uint depositedAmount;
        uint remainingAmount;
        uint[] dcaPositionIds;
        VaultPosition[] vaultPositions;
        bool closed;
    }

    struct InitializeParams {
        address owner;
        address treasury;
        IERC20Upgradeable stable;
        SubscriptionManager subscriptionManager;
        DollarCostAverage dca;
        VaultManager vaultManager;
        ZapManager zapManager;
        uint8 maxHottestStrategies;
        uint32 strategistPercentage;
        uint32 hotStrategistPercentage;
    }

    /**
     * @dev swaps bytes are the encoded versions of ZapManager.ProtocolCall used in the callProtocol function
     */
    struct InvestArgs {
        uint strategyId;
        IERC20Upgradeable inputToken;
        uint inputAmount;
        bytes inputTokenSwap;
        bytes[] dcaSwaps;
        bytes[] vaultSwaps;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
    }

    struct InvestInProductArgs {
        uint strategyId;
        uint amount;
        bytes[] swaps;
    }

    struct PullFundsArgs {
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

    mapping(address => Position[]) internal _positions;
    mapping(address => uint) internal _strategistRewards;
    Strategy[] internal _strategies;

    IERC20Upgradeable public stable;
    SubscriptionManager public subscriptionManager;
    DollarCostAverage public dca;
    VaultManager public vaultManager;
    ZapManager public zapManager;

    mapping(uint => bool) internal _hottestStrategiesMapping;
    uint[] internal _hottestStrategiesArray;
    uint8 public maxHottestStrategies;
    uint public dust;

    uint32 public strategistPercentage;
    uint32 public hotStrategistPercentage;

    event StrategyCreated(address creator, uint strategyId, bytes32 metadataHash);
    event PositionCreated(
        address owner,
        uint strategyId,
        uint positionId,
        address inputToken,
        uint inputTokenAmount,
        uint stableAmount,
        uint[] dcaPositionIds,
        VaultPosition[] vaultPositions
    );
    event PositionClosed(address owner, uint strategyId, uint positionId, uint[][] dcaWithdrawnAmounts, uint[] vaultWithdrawnAmount);
    event PositionCollected(address owner, uint strategyId, uint positionId, uint[] dcaWithdrawnAmounts);
    event Fee(address from, address to, uint amount, bytes data);
    event Dust(address from, uint strategyId, uint amount);
    event DustCollected(address to, uint amount);
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
    error InvalidSwapsLength();
    error PositionAlreadyClosed();
    error InvalidPositionId(address investor, uint positionId);

    function initialize(InitializeParams calldata _initializeParams) external initializer {
        __Ownable_init();

        setMaxHottestStrategies(_initializeParams.maxHottestStrategies);
        setStrategistPercentage(_initializeParams.strategistPercentage);
        setHotStrategistPercentage(_initializeParams.hotStrategistPercentage);
        setTreasury(_initializeParams.treasury);

        transferOwnership(_initializeParams.owner);

        stable = _initializeParams.stable;
        subscriptionManager = _initializeParams.subscriptionManager;
        dca = _initializeParams.dca;
        vaultManager = _initializeParams.vaultManager;
        zapManager = _initializeParams.zapManager;
    }

    function createStrategy(
        DcaStrategy[] memory _dcaInvestments,
        VaultStrategy[] memory _vaultInvestments,
        SubscriptionManager.Permit calldata _permit,
        bytes32 metadataHash
    ) external virtual {
        uint investmentCount = _dcaInvestments.length + _vaultInvestments.length;

        if (!subscriptionManager.isSubscribed(msg.sender, _permit))
            revert Unauthorized();

        if (investmentCount > 20)
            revert TooManyInvestments();

        uint8 dcaPercentage;
        uint8 vaultPercentage;

        for (uint i = 0; i < _dcaInvestments.length; i++)
            dcaPercentage += _dcaInvestments[i].percentage;

        for (uint i = 0; i < _vaultInvestments.length; i++)
            vaultPercentage += _vaultInvestments[i].percentage;

        if ((dcaPercentage + vaultPercentage) != 100)
            revert InvalidTotalPercentage();

        Strategy storage strategy = _strategies.push();
        strategy.creator = msg.sender;
        strategy.dcaPercentage = dcaPercentage;
        strategy.vaultPercentage = vaultPercentage;

        // Assigning isn't possible because you can't convert an array of structs from memory to storage
        for (uint i = 0; i < _dcaInvestments.length; i++) {
            DcaStrategy memory dcaStrategy = _dcaInvestments[i];

            if (dcaStrategy.poolId >= dca.getPoolsLength())
                revert InvalidInvestment();

            strategy.dcaInvestments.push(dcaStrategy);
        }

        for (uint i = 0; i < _vaultInvestments.length; i++) {
            VaultStrategy memory vaultStrategy = _vaultInvestments[i];

            if (!vaultManager.whitelistedVaults(vaultStrategy.vault))
                revert InvalidInvestment();

            strategy.vaultInvestments.push(vaultStrategy);
        }

        emit StrategyCreated(msg.sender, _strategies.length - 1, metadataHash);
    }

    function invest(InvestArgs calldata _args) external virtual {
        if (_args.strategyId > _strategies.length)
            revert StrategyUnavailable();

        Strategy storage strategy = _strategies[_args.strategyId];
        address strategist = subscriptionManager.isSubscribed(strategy.creator, _args.strategistPermit)
            ? strategy.creator
            : address(0);

        uint initialBalance = stable.balanceOf(address(this));

        PullFundsResult memory pullFundsResult = _pullFunds(
            PullFundsArgs({
                strategist: strategist,
                strategyId: _args.strategyId,
                inputToken: _args.inputToken,
                inputAmount: _args.inputAmount,
                inputTokenSwap: _args.inputTokenSwap,
                permit: _args.investorPermit
            })
        );

        uint[] memory dcaPositionIds = _investInDca(
            InvestInProductArgs({
                strategyId: _args.strategyId,
                amount: pullFundsResult.remainingAmount,
                swaps: _args.dcaSwaps
            })
        );
        VaultPosition[] memory vaultPositions = _investInVaults(
            InvestInProductArgs({
                strategyId: _args.strategyId,
                amount: pullFundsResult.remainingAmount,
                swaps: _args.vaultSwaps
            })
        );

        uint _dust = stable.balanceOf(address(this)) - initialBalance - pullFundsResult.strategistFee;

        if (_dust > 0) {
            dust += _dust;

            emit Dust(msg.sender, _args.strategyId, _dust);
        }

        strategy.totalDeposits += _args.inputAmount;

        uint positionId = _positions[msg.sender].length;

        Position storage position = _positions[msg.sender].push();

        position.strategyId = _args.strategyId;
        position.depositedAmount = _args.inputAmount;
        position.remainingAmount = pullFundsResult.remainingAmount;
        position.dcaPositionIds = dcaPositionIds;

        for (uint i = 0; i < vaultPositions.length; i++)
            position.vaultPositions.push(vaultPositions[i]);

        emit PositionCreated(
            msg.sender,
            _args.strategyId,
            positionId,
            address(_args.inputToken),
            _args.inputAmount,
            pullFundsResult.remainingAmount,
            dcaPositionIds,
            vaultPositions
        );
    }

    function closePosition(uint _positionId) external virtual {
        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        position.closed = true;

        uint[][] memory dcaWithdrawnAmounts = new uint[][](position.dcaPositionIds.length);
        uint[] memory vaultsWithdrawnAmounts = new uint[](position.vaultPositions.length);

        // close dca positions
        for (uint i = 0; i < position.dcaPositionIds.length; i++) {
            DollarCostAverage.PositionInfo memory dcaPosition = dca.getPosition(
                address(this),
                position.dcaPositionIds[i]
            );
            DollarCostAverage.PoolInfo memory poolInfo = dca.getPool(dcaPosition.poolId);
            IERC20Upgradeable inputToken = IERC20Upgradeable(poolInfo.inputToken);
            IERC20Upgradeable outputToken = IERC20Upgradeable(poolInfo.outputToken);
            uint initialInputTokenBalance = inputToken.balanceOf(address(this));
            uint initialOutputTokenBalance = outputToken.balanceOf(address(this));

            dca.withdrawAll(position.dcaPositionIds[i]);

            uint inputTokenAmount = inputToken.balanceOf(address(this)) - initialInputTokenBalance;
            uint outputTokenAmount = outputToken.balanceOf(address(this)) - initialOutputTokenBalance;

            if (inputTokenAmount > 0 || outputTokenAmount > 0) {
                dcaWithdrawnAmounts[i] = new uint[](2);

                if (inputTokenAmount > 0) {
                    dcaWithdrawnAmounts[i][0] = inputTokenAmount;
                    inputToken.safeTransfer(msg.sender, inputTokenAmount);
                }

                if (outputTokenAmount > 0) {
                    dcaWithdrawnAmounts[i][1] = outputTokenAmount;
                    outputToken.safeTransfer(msg.sender, outputTokenAmount);
                }
            }
        }

        // close vault positions
        for (uint i = 0; i < position.vaultPositions.length; i++) {
            VaultPosition memory vaultPosition = position.vaultPositions[i];
            IBeefyVaultV7 vault = IBeefyVaultV7(vaultPosition.vault);

            uint initialBalance = vault.want().balanceOf(address(this));

            vault.withdraw(vaultPosition.amount);

            uint withdrawnAmount = vault.want().balanceOf(address(this)) - initialBalance;

            if (withdrawnAmount > 0) {
                vaultsWithdrawnAmounts[i] = withdrawnAmount;
                vault.want().safeTransfer(msg.sender, withdrawnAmount);
            }
        }

        emit PositionClosed(
            msg.sender,
            position.strategyId,
            _positionId,
            dcaWithdrawnAmounts,
            vaultsWithdrawnAmounts
        );
    }

    function collectPosition(uint _positionId) external virtual {
        if (_positionId >= _positions[msg.sender].length)
            revert InvalidPositionId(msg.sender, _positionId);

        Position storage position = _positions[msg.sender][_positionId];

        if (position.closed)
            revert PositionAlreadyClosed();

        uint[] memory dcaWithdrawnAmounts = new uint[](position.dcaPositionIds.length);

        for (uint i; i < position.dcaPositionIds.length; i++) {
            DollarCostAverage.PositionInfo memory dcaPosition = dca.getPosition(
                address(this),
                position.dcaPositionIds[i]
            );
            DollarCostAverage.PoolInfo memory poolInfo = dca.getPool(dcaPosition.poolId);
            IERC20Upgradeable outputToken = IERC20Upgradeable(poolInfo.outputToken);
            uint initialOutputTokenBalance = outputToken.balanceOf(address(this));

            dca.withdrawSwapped(position.dcaPositionIds[i]);

            uint outputTokenAmount = outputToken.balanceOf(address(this)) - initialOutputTokenBalance;

            if (outputTokenAmount > 0) {
                dcaWithdrawnAmounts[i] = outputTokenAmount;
                outputToken.safeTransfer(msg.sender, outputTokenAmount);
            }
        }

        emit PositionCollected(
            msg.sender,
            position.strategyId,
            _positionId,
            dcaWithdrawnAmounts
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

    function getPositions(address _investor) external virtual view returns (Position[] memory) {
        return _positions[_investor];
    }

    function getStrategy(uint _strategyId) external virtual view returns (Strategy memory) {
        return _strategies[_strategyId];
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

    function _investInDca(
        InvestInProductArgs memory _args
    ) internal virtual returns (uint[] memory) {
        Strategy memory strategy = _strategies[_args.strategyId];

        if (strategy.dcaInvestments.length == 0)
            return new uint[](0);

        if (_args.swaps.length != strategy.dcaInvestments.length)
            revert InvalidSwapsLength();

        uint[] memory dcaPositionIds = new uint[](strategy.dcaInvestments.length);
        uint nextDcaPositionId = dca.getPositionsLength(address(this));

        for (uint i = 0; i < strategy.dcaInvestments.length; i++) {
            DcaStrategy memory investment = strategy.dcaInvestments[i];
            IERC20Upgradeable inputToken = IERC20Upgradeable(dca.getPool(investment.poolId).inputToken);

            uint swapOutput = _swapOrZapIfNecessary(
                _args.swaps[i],
                stable,
                inputToken,
                _args.amount * investment.percentage / 100
            );

            inputToken.safeIncreaseAllowance(address(dca), swapOutput);

            dca.depositUsingStrategy(investment.poolId, investment.swaps, swapOutput);

            dcaPositionIds[i] = nextDcaPositionId;
            nextDcaPositionId++;
        }

        return dcaPositionIds;
    }

    function _investInVaults(
        InvestInProductArgs memory _args
    ) internal virtual returns (VaultPosition[] memory) {
        Strategy memory strategy = _strategies[_args.strategyId];

        if (strategy.vaultInvestments.length == 0)
            return new VaultPosition[](0);

        if (_args.swaps.length != strategy.vaultInvestments.length)
            revert InvalidSwapsLength();

        VaultPosition[] memory vaultPositions = new VaultPosition[](strategy.vaultInvestments.length);

        for (uint i = 0; i < strategy.vaultInvestments.length; i++) {
            VaultStrategy memory investment = strategy.vaultInvestments[i];
            IBeefyVaultV7 vault = IBeefyVaultV7(investment.vault);
            IERC20Upgradeable inputToken = vault.want();

            uint swapOutput = _swapOrZapIfNecessary(
                _args.swaps[i],
                stable,
                inputToken,
                _args.amount * investment.percentage / 100
            );

            inputToken.safeIncreaseAllowance(address(vaultManager), swapOutput);

            uint initialBalance = vault.balanceOf(address(this));
            vaultManager.depositUsingStrategy(investment.vault, swapOutput);
            vaultPositions[i] = VaultPosition(
                investment.vault,
                vault.balanceOf(address(this)) - initialBalance
            );
        }

        return vaultPositions;
    }

    function _pullFunds(
        PullFundsArgs memory _args
    ) internal virtual returns (
        PullFundsResult memory
    ) {
        Strategy memory strategy = _strategies[_args.strategyId];

        uint currentStrategistPercentage = isHot(_args.strategyId)
            ? hotStrategistPercentage
            : strategistPercentage;
        uint initialInputTokenBalance = _args.inputToken.balanceOf(address(this));

        _args.inputToken.safeTransferFrom(msg.sender, address(this), _args.inputAmount);

        // Convert to stable if input token is not stable and set amount in stable terms
        uint stableAmount = _args.inputToken == stable
            ? _args.inputToken.balanceOf(address(this)) - initialInputTokenBalance
            : _swapOrZapIfNecessary(
                _args.inputTokenSwap,
                _args.inputToken,
                stable,
                _args.inputToken.balanceOf(address(this)) - initialInputTokenBalance
            );

        uint protocolFee;
        uint strategistFee;

        if (strategy.dcaPercentage > 0) {
            (uint _protocolFee, uint _strategistFee) = _calculateProductFee(
                address(dca),
                msg.sender,
                _args.strategist,
                stableAmount * strategy.dcaPercentage / 100,
                currentStrategistPercentage,
                _args.permit
            );

            protocolFee += _protocolFee;
            strategistFee += _strategistFee;
        }

        if (strategy.vaultPercentage > 0) {
            (uint _protocolFee, uint _strategistFee) = _calculateProductFee(
                address(vaultManager),
                msg.sender,
                _args.strategist,
                stableAmount * strategy.vaultPercentage / 100,
                currentStrategistPercentage,
                _args.permit
            );

            protocolFee += _protocolFee;
            strategistFee += _strategistFee;
        }

        stable.safeTransfer(treasury, protocolFee);

        if (strategistFee > 0) {
            _strategistRewards[_args.strategist] += strategistFee;

            emit Fee(msg.sender, _args.strategist, strategistFee, abi.encode(_args.strategyId));
        }

        emit Fee(msg.sender, treasury, protocolFee, abi.encode(_args.strategyId));

        return PullFundsResult(
            stableAmount - (protocolFee + strategistFee),
            strategistFee
        );
    }

    function _swapOrZapIfNecessary(
        bytes memory _swapOrZap,
        IERC20Upgradeable _inputToken,
        IERC20Upgradeable _outputToken,
        uint _amount
    ) internal virtual returns (uint) {
        if (_swapOrZap.length > 1) {
            _inputToken.safeTransfer(address(zapManager), _amount);

            uint initialBalance = _outputToken.balanceOf(address(this));

            (bool success, bytes memory data) = address(zapManager).call(_swapOrZap);

            if (!success)
                revert LowLevelCallFailed(address(zapManager), _swapOrZap, data);

            return _outputToken.balanceOf(address(this)) - initialBalance;
        }

        return _amount;
    }

    /**
     * @dev Takes the base fee of a product and splits it between the protocol and strategist fees by applying the current strategist percentage.
     *
     * @param _product The product to calculate the fee for
     * @param _user The user that is paying the fee
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
        address _user,
        address _strategist,
        uint _amount,
        uint _currentStrategistPercentage,
        SubscriptionManager.Permit memory _permit
    ) internal virtual view returns (
        uint protocolFee,
        uint strategistFee
    ) {
        (uint baseFee, uint nonSubscriberFee) = UseFee(_product).calculateFee(
            _user,
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

        for (uint i = 0; i < _hottestStrategiesArray.length; i++)
            _hottestStrategiesMapping[_hottestStrategiesArray[i]] = false;

        for (uint i = 0; i < _strategyIds.length; i++)
            _hottestStrategiesMapping[_strategyIds[i]] = true;

        _hottestStrategiesArray = _strategyIds;

        emit HottestStrategiesUpdated(_strategyIds);
    }

    function setMaxHottestStrategies(uint8 _maxHottestStrategies) public virtual onlyOwner {
        maxHottestStrategies = _maxHottestStrategies;

        emit MaxHotStrategiesUpdated(_maxHottestStrategies);
    }

    function collectDust() external virtual {
        if (msg.sender != owner() || msg.sender != treasury)
            revert Unauthorized();

        uint _dust = dust;

        dust = 0;
        stable.safeTransfer(treasury, _dust);

        emit DustCollected(msg.sender, _dust);
    }
}
