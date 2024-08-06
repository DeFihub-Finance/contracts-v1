// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import {MathHelpers} from "./helpers/MathHelpers.sol";
import {HubOwnable} from "./abstract/HubOwnable.sol";
import {OnlyStrategyManager} from "./abstract/OnlyStrategyManager.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {SubscriptionManager} from "./SubscriptionManager.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract DollarCostAverage is HubOwnable, UseFee, OnlyStrategyManager, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct PositionInfo {
        // @dev Single slot
        uint16 swaps;
        uint16 finalSwap;
        uint16 lastUpdateSwap;
        // @dev Uses uint208 to fill the remaining of the slot
        uint208 poolId;

        // @dev Single slot
        uint amountPerSwap;
    }

    struct PoolInfo {
        // Single slot
        address inputToken;

        // @dev Single slot
        address outputToken;
        // @dev Able to represent up to 596_523 hours
        uint32 interval;
        uint16 performedSwaps;

        // @dev One slot each
        uint nextSwapAmount;
        uint lastSwapTimestamp;
        address router;
        bytes path;
    }

    struct SwapInfo {
        // @dev This must match the type of PositionInfo.poolId
        uint208 poolId;
        uint minOutputAmount;
    }

    struct InitializeParams {
        address owner;
        address treasury;
        address swapper;
        address strategyManager;
        address subscriptionManager;
        uint32 baseFeeBP;
        uint32 nonSubscriberFeeBP;
    }

    uint128 public constant SWAP_QUOTE_PRECISION = 10 ** 18;
    uint32 public constant MIN_INTERVAL = 8 hours;
    uint8 private constant HOP_ENCODING_SIZE_IN_BYTES = 43;

    // @dev user => position
    mapping(address => PositionInfo[]) internal positionInfo;
    // @dev poolId => swap number => delta
    mapping(uint208 => mapping(uint16 => uint)) internal endingPositionDeduction;
    // @dev poolId => swap number => accumulated ratio
    mapping(uint208 => mapping(uint16 => uint)) internal accruedSwapQuoteByPool;

    PoolInfo[] internal poolInfo;
    address public swapper;

    error InvalidPoolId();
    error InvalidAmount();
    error InvalidNumberOfSwaps();
    error TooEarlyToSwap(uint timeRemaining);
    error NoTokensToSwap();
    error InvalidPositionId();
    error InvalidPoolPath();
    error InvalidPoolInterval();
    error CallerIsNotSwapper();

    event PoolCreated(uint208 poolId, address inputToken, address outputToken, address router, bytes path, uint interval);
    event PositionCreated(address user, uint208 poolId, uint positionId, uint swaps, uint amountPerSwap, uint finalSwap);
    event PositionCollected(address user, uint positionId, uint outputTokenAmount);
    event PositionClosed(address user, uint positionId, uint inputTokenAmount, uint outputTokenAmount);
    event Swap(uint208 poolId, uint amountIn, uint amountOut);
    event SetPoolPath(uint208 poolId, bytes oldPath, bytes newPath);
    event SetPoolRouter(uint208 poolId, address oldRouter, address newRouter);
    event SetSwapper(address oldSwapper, address newSwapper);

    function initialize(InitializeParams calldata _initializeParams) external initializer {
        if (_initializeParams.swapper == address(0))
            revert InvalidZeroAddress();

        __ReentrancyGuard_init();
        __Ownable_init();
        __UseFee_init(
            _initializeParams.treasury,
            _initializeParams.subscriptionManager,
            _initializeParams.baseFeeBP,
            _initializeParams.nonSubscriberFeeBP
        );
        __OnlyStrategyManager_init(_initializeParams.strategyManager);

        transferOwnership(_initializeParams.owner);

        swapper = _initializeParams.swapper;
    }

    function createPool(
        address _inputToken,
        address _outputToken,
        address _router,
        bytes calldata _path,
        uint32 _interval
    ) external virtual onlyOwner {
        if (_interval < MIN_INTERVAL)
            revert InvalidPoolInterval();

        (address firstToken, address lastToken) = extractAddresses(_path);

        if (firstToken != _inputToken || lastToken != _outputToken)
            revert InvalidPoolPath();

        if (
            _inputToken == address(0) ||
            _outputToken == address(0) ||
            _router == address(0)
        )
            revert InvalidZeroAddress();

        uint208 poolId = uint208(poolInfo.length);

        poolInfo.push(PoolInfo({
            inputToken: _inputToken,
            outputToken: _outputToken,
            router: _router,
            path: _path,
            interval: _interval,
            nextSwapAmount: 0,
            performedSwaps: 0,
            lastSwapTimestamp: 0
        }));

        emit PoolCreated(poolId, _inputToken, _outputToken, _router, _path, _interval);
    }

    function invest(
        uint208 _poolId,
        uint16 _swaps,
        uint _amount,
        SubscriptionManager.Permit calldata _subscriptionPermit
    ) external virtual {
        if (_poolId >= poolInfo.length)
            revert InvalidPoolId();

        if (_swaps == 0)
            revert InvalidNumberOfSwaps();

        PoolInfo memory pool = poolInfo[_poolId];

        _invest(
            _poolId,
            _swaps,
            _pullFunds(
                pool.inputToken,
                _amount,
                abi.encode(_poolId),
                _subscriptionPermit
            )
        );
    }

    function investUsingStrategy(
        uint208 _poolId,
        uint16 _swaps,
        uint _amount
    ) external virtual onlyStrategyManager {
        _invest(_poolId, _swaps, _amount);
    }

    function _invest(uint208 _poolId, uint16 _swaps, uint _amount) internal virtual {
        if (_amount == 0)
            revert InvalidAmount();

        PoolInfo storage pool = poolInfo[_poolId];

        uint amountPerSwap = _amount / _swaps;
        uint16 finalSwap = pool.performedSwaps + _swaps;

        pool.nextSwapAmount += amountPerSwap;
        endingPositionDeduction[_poolId][finalSwap + 1] += amountPerSwap;

        uint positionId = positionInfo[msg.sender].length;

        positionInfo[msg.sender].push(
            PositionInfo({
                swaps: _swaps,
                amountPerSwap: amountPerSwap,
                poolId: _poolId,
                finalSwap: finalSwap,
                lastUpdateSwap: pool.performedSwaps
            })
        );

        emit PositionCreated(msg.sender, _poolId, positionId, _swaps, amountPerSwap, finalSwap);
    }

    function swap(SwapInfo[] calldata swapInfo) external virtual nonReentrant {
        if (msg.sender != swapper)
            revert CallerIsNotSwapper();

        uint timestamp = block.timestamp;

        for (uint32 i; i < swapInfo.length; ++i) {
            uint208 poolId = swapInfo[i].poolId;

            if (poolId >= poolInfo.length)
                revert InvalidPoolId();

            PoolInfo storage pool = poolInfo[poolId];

            if (timestamp < pool.lastSwapTimestamp + pool.interval)
                revert TooEarlyToSwap(pool.lastSwapTimestamp + pool.interval - timestamp);

            uint inputTokenAmount = pool.nextSwapAmount;

            if (inputTokenAmount == 0)
                revert NoTokensToSwap();

            uint contractBalanceBeforeSwap = IERC20Upgradeable(pool.outputToken).balanceOf(address(this));

            IERC20Upgradeable(pool.inputToken).safeApprove(pool.router, inputTokenAmount);
            ISwapRouter(pool.router).exactInput(ISwapRouter.ExactInputParams({
                path: pool.path,
                recipient: address(this),
                deadline: timestamp,
                amountIn: inputTokenAmount,
                amountOutMinimum: swapInfo[i].minOutputAmount
            }));

            uint outputTokenAmount = IERC20Upgradeable(pool.outputToken).balanceOf(address(this)) - contractBalanceBeforeSwap;
            uint swapQuote = (outputTokenAmount * SWAP_QUOTE_PRECISION) / inputTokenAmount;
            mapping(uint16 => uint) storage poolAccruedQuotes = accruedSwapQuoteByPool[poolId];

            poolAccruedQuotes[pool.performedSwaps + 1] = poolAccruedQuotes[pool.performedSwaps] + swapQuote;

            pool.performedSwaps += 1;
            pool.nextSwapAmount -= endingPositionDeduction[poolId][pool.performedSwaps + 1];
            pool.lastSwapTimestamp = timestamp;

            emit Swap(poolId, inputTokenAmount, outputTokenAmount);
        }
    }

    function closePosition(uint _positionId) external virtual nonReentrant {
        PositionInfo[] storage userPositions = positionInfo[msg.sender];

        if (_positionId >= userPositions.length)
            revert InvalidPositionId();

        PositionInfo storage position = userPositions[_positionId];
        PoolInfo storage pool = poolInfo[position.poolId];

        uint inputTokenAmount = _calculateInputTokenBalance(msg.sender, _positionId);
        uint outputTokenAmount = _calculateOutputTokenBalance(msg.sender, _positionId);

        if (position.finalSwap > pool.performedSwaps) {
            pool.nextSwapAmount -= position.amountPerSwap;
            endingPositionDeduction[position.poolId][position.finalSwap + 1] -= position.amountPerSwap;
        }

        position.lastUpdateSwap = pool.performedSwaps;
        position.amountPerSwap = 0;

        if (inputTokenAmount > 0)
            IERC20Upgradeable(pool.inputToken).safeTransfer(msg.sender, inputTokenAmount);

        if (outputTokenAmount > 0)
            IERC20Upgradeable(pool.outputToken).safeTransfer(msg.sender, outputTokenAmount);

        emit PositionClosed(msg.sender, _positionId, inputTokenAmount, outputTokenAmount);
    }

    function collectPosition(uint _positionId) external virtual nonReentrant {
        PositionInfo[] storage userPositions = positionInfo[msg.sender];

        if (_positionId >= userPositions.length)
            revert InvalidPositionId();

        PositionInfo storage position = userPositions[_positionId];
        PoolInfo memory pool = poolInfo[position.poolId];

        uint outputTokenAmount = _calculateOutputTokenBalance(msg.sender, _positionId);

        position.lastUpdateSwap = pool.performedSwaps;

        IERC20Upgradeable(pool.outputToken).safeTransfer(msg.sender, outputTokenAmount);

        emit PositionCollected(msg.sender, _positionId, outputTokenAmount);
    }

    function setPoolRouterAndPath(
        uint208 _poolId,
        address _router,
        bytes calldata _path
    ) external virtual onlyOwner {
        setPoolPath(_poolId, _path);
        setPoolRouter(_poolId, _router);
    }

    function setSwapper(address _swapper) external virtual onlyOwner {
        if (_swapper == address(0))
            revert InvalidZeroAddress();

        emit SetSwapper(swapper, _swapper);
        swapper = _swapper;
    }

    function getPoolsLength() external virtual view returns (uint) {
        return poolInfo.length;
    }

    function getPool(uint208 poolId) public virtual view returns (PoolInfo memory) {
        return poolInfo[poolId];
    }

    function getPositionsLength(address _user) external virtual view returns (uint) {
        return positionInfo[_user].length;
    }

    function getPosition(address _user, uint _positionId) external virtual view returns (PositionInfo memory) {
        if (_positionId >= positionInfo[_user].length)
            revert InvalidPositionId();

        return positionInfo[_user][_positionId];
    }

    function getPositions(address _user) external virtual view returns (PositionInfo[] memory) {
        return positionInfo[_user];
    }

    function getPositionBalances(
        address _user,
        uint _positionId
    ) public virtual view returns (
        uint inputTokenBalance,
        uint outputTokenBalance
    ) {
        inputTokenBalance = _calculateInputTokenBalance(_user, _positionId);
        outputTokenBalance = _calculateOutputTokenBalance(_user, _positionId);
    }

    function poolPath(uint208 _poolId) external virtual view returns (bytes memory path) {
        if (_poolId >= poolInfo.length)
            revert InvalidPoolId();

        return poolInfo[_poolId].path;
    }

    function setPoolPath(uint208 _poolId, bytes calldata _path) public virtual onlyOwner {
        if (_poolId >= poolInfo.length)
            revert InvalidPoolId();

        PoolInfo storage pool = poolInfo[_poolId];

        (address firstToken, address lastToken) = extractAddresses(_path);

        if (firstToken != pool.inputToken || lastToken != pool.outputToken)
            revert InvalidPoolPath();

        emit SetPoolPath(_poolId, pool.path, _path);

        pool.path = _path;
    }

    function setPoolRouter(uint208 _poolId, address _router) public virtual onlyOwner {
        if (_router == address(0))
            revert InvalidZeroAddress();

        address oldRouter = poolInfo[_poolId].router;

        poolInfo[_poolId].router = _router;

        emit SetPoolRouter(_poolId, oldRouter, _router);
    }

    function _calculateOutputTokenBalance(address _user, uint _positionId) internal virtual view returns (uint) {
        PositionInfo memory position = positionInfo[_user][_positionId];
        PoolInfo memory pool = poolInfo[position.poolId];

        uint16 swapToConsider = MathHelpers.minU16(pool.performedSwaps, position.finalSwap);

        // @dev This means that the last interaction was happened before a new swap happened
        // and the user already withdrawn all the output tokens
        if (position.lastUpdateSwap > swapToConsider)
            return 0;

        uint quoteAtMostRecentSwap = accruedSwapQuoteByPool[position.poolId][swapToConsider];
        uint quoteAtLastUpdate = accruedSwapQuoteByPool[position.poolId][position.lastUpdateSwap];
        uint positionAccumulatedRatio = quoteAtMostRecentSwap - quoteAtLastUpdate;

        return positionAccumulatedRatio * position.amountPerSwap / SWAP_QUOTE_PRECISION;
    }

    function _calculateInputTokenBalance(
        address _user,
        uint _positionId
    ) internal virtual view returns (uint) {
        PositionInfo memory position = positionInfo[_user][_positionId];
        uint performedSwaps = poolInfo[position.poolId].performedSwaps;

        if (position.finalSwap < performedSwaps)
            return 0;

        return (position.finalSwap - performedSwaps) * position.amountPerSwap;
    }

    // Extracts the first and last addresses from the given bytes data
    function extractAddresses(
        bytes memory data
    ) internal pure returns (
        address _inputToken,
        address _outputToken
    ) {
        if (data.length < 40)
            revert InvalidPoolPath();

        // Initialize variables for addresses
        uint firstAddressBytes;
        uint lastAddressBytes;

        // Calculate the offset for the start of the last address
        uint lastAddressOffset = data.length - 20;

        // To extract the first address, load the first 20 bytes as an address directly
        assembly {
            firstAddressBytes := mload(add(data, 20))
        }

        // To Extracting the last address, load the last 20 bytes as an address
        assembly {
            lastAddressBytes := mload(add(data, add(lastAddressOffset, 20)))
        }

        _inputToken = address(uint160(firstAddressBytes));
        _outputToken = address(uint160(lastAddressBytes));
    }
}
