// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {HubOwnable} from "./abstract/HubOwnable.sol";
import {OnlyStrategyManager} from "./abstract/OnlyStrategyManager.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {UseTreasury} from "./abstract/UseTreasury.sol";
import {UseDust} from "./abstract/UseDust.sol";
import {StrategyManager} from "./StrategyManager.sol";
import {SubscriptionManager} from "./SubscriptionManager.sol";
import {ZapManager} from "./zap/ZapManager.sol";

contract LiquidityManager is HubOwnable, UseFee, UseDust, OnlyStrategyManager {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    ZapManager public zapManager;
    // @notice position managers must be whitelisted to prevent scam strategies using fake position managers
    mapping(address => bool) public positionManagerWhitelist;

    struct InitializeParams {
        address owner;
        address treasury;
        address subscriptionManager;
        address strategyManager;
        ZapManager zapManager;
        uint32 baseFeeBP;
        uint32 nonSubscriberFeeBP;
    }

    struct AddLiquidityV3Params {
        address positionManager;
        IERC20Upgradeable inputToken;
        IERC20Upgradeable token0;
        IERC20Upgradeable token1;
        uint24 fee;
        uint depositAmountInputToken;
        bytes swapToken0;
        bytes swapToken1;
        uint swapAmountToken0;
        uint swapAmountToken1;
        int24 tickLower;
        int24 tickUpper;
        uint amount0Min;
        uint amount1Min;
    }

    error InsufficientFunds(uint requested, uint available);
    error InvalidInvestment();

    // TODO test gas consumption of all functions using calldata vs memory
    function initialize(InitializeParams calldata _params) external initializer {
        __Ownable_init();
        __UseFee_init(
            _params.treasury,
            _params.subscriptionManager,
            _params.baseFeeBP,
            _params.nonSubscriberFeeBP
        );
        __OnlyStrategyManager_init(_params.strategyManager);

        transferOwnership(_params.owner);

        zapManager = _params.zapManager;
    }

    function addLiquidityV3(
        AddLiquidityV3Params calldata _params,
        SubscriptionManager.Permit calldata _subscriptionPermit
    ) external virtual returns (
        uint tokenId,
        uint128 liquidity
    ) {
        uint depositFee = _collectProtocolFees(
            address(_params.inputToken),
            _params.depositAmountInputToken,
            abi.encode(_params.inputToken, _params.token0, _params.token1, _params.fee),
            _subscriptionPermit
        );

        uint requested = _params.swapAmountToken0 + _params.swapAmountToken1;
        uint available = _params.depositAmountInputToken - depositFee;

        _params.inputToken.safeTransferFrom(msg.sender, address(this), available);

        if (requested > available)
            revert InsufficientFunds(requested, available);

        return _addLiquidityV3(_params);
    }

    function addLiquidityV3UsingStrategy(
        AddLiquidityV3Params calldata _params
    ) external virtual onlyStrategyManager returns (
        uint tokenId,
        uint128 liquidity
    ) {
        return _addLiquidityV3(_params);
    }

    function _addLiquidityV3(
        AddLiquidityV3Params calldata _params
    ) internal virtual returns (
        uint tokenId,
        uint128 liquidity
    ) {
        if (
            !positionManagerWhitelist[_params.positionManager] ||
            _params.token0 > _params.token1
        )
            revert InvalidInvestment();

        _params.inputToken.safeIncreaseAllowance(
            address(zapManager),
            _params.swapAmountToken0 + _params.swapAmountToken1
        );

        uint amountToken0 = zapManager.zap(
            _params.swapToken0,
            _params.inputToken,
            _params.token0,
            _params.swapAmountToken0
        );
        uint amountToken1 = zapManager.zap(
            _params.swapToken1,
            _params.inputToken,
            _params.token1,
            _params.swapAmountToken1
        );

        // TODO test gas savings with infinite approval if safe
        _params.token0.safeIncreaseAllowance(address(_params.positionManager), amountToken0);
        _params.token1.safeIncreaseAllowance(address(_params.positionManager), amountToken1);

        (tokenId, liquidity,,) = INonfungiblePositionManager(_params.positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: address(_params.token0),
                token1: address(_params.token1),
                fee: _params.fee,
                tickLower: _params.tickLower,
                tickUpper: _params.tickUpper,
                amount0Desired: amountToken0,
                amount1Desired: amountToken1,
                amount0Min: _params.amount0Min,
                amount1Min: _params.amount1Min,
                recipient: msg.sender,
                deadline: block.timestamp
            })
        );
    }

    function setPositionManagerWhitelist(
        address _positionManager,
        bool _whitelisted
    ) external virtual onlyOwner {
        positionManagerWhitelist[_positionManager] = _whitelisted;
    }

    function sendDust(IERC20Upgradeable _token, address _to) external virtual onlyStrategyManager {
        _sendDust(_token, _to);
    }
}
