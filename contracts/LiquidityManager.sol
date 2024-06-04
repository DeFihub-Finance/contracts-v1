// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {HubOwnable} from "./abstract/HubOwnable.sol";
import {UseZap} from "./abstract/UseZap.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {UseTreasury} from "./abstract/UseTreasury.sol";
import {StrategyManager} from "./StrategyManager.sol";
import {SubscriptionManager} from "./SubscriptionManager.sol";
import {ZapManager} from "./zap/ZapManager.sol";

contract LiquidityManager is HubOwnable, UseZap, UseFee {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public strategyManager;

    struct InitializeParams {
        address strategyManager;
        ZapManager zapManager;
        address owner;
        address treasury;
        address subscriptionManager;
        uint32 baseFeeBP;
        uint32 nonSubscriberFeeBP;
    }

    struct AddLiquidityV3Params {
        INonfungiblePositionManager positionManager;
        IERC20Upgradeable inputToken;
        IERC20Upgradeable token0;
        IERC20Upgradeable token1;
        bytes swapToken0;
        bytes swapToken1;
        uint depositAmountInputToken;
        uint swapAmountToken0;
        uint swapAmountToken1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint amount0Min;
        uint amount1Min;
        bytes zapToken0;
        bytes zapToken1;
    }

    error InsufficientFunds(uint requested, uint available);
    error Unauthorized();

    function initialize(InitializeParams calldata _params) external initializer {
        __Ownable_init();
        __UseZap_init(_params.zapManager);
        __UseFee_init(
            _params.treasury,
            _params.subscriptionManager,
            _params.baseFeeBP,
            _params.nonSubscriberFeeBP
        );

        transferOwnership(_params.owner);

        strategyManager = _params.strategyManager;
    }

    function addLiquidityV3(
        AddLiquidityV3Params calldata _params,
        SubscriptionManager.Permit calldata _subscriptionPermit
    ) external virtual returns (
        uint tokenId,
        uint128 liquidity
    ) {
        _params.inputToken.safeTransferFrom(msg.sender, address(this), _params.depositAmountInputToken);

        uint depositFee = _collectProtocolFees(
            address(_params.inputToken),
            _params.depositAmountInputToken,
            abi.encode(_params.inputToken, _params.token0, _params.token1, _params.fee),
            _subscriptionPermit
        );

        uint requested = _params.swapAmountToken0 + _params.swapAmountToken1;
        uint available = _params.depositAmountInputToken - depositFee;

        if (requested > available)
            revert InsufficientFunds(requested, available);

        return _addLiquidityV3(_params);
    }

    function addLiquidityV3UsingStrategy(
        AddLiquidityV3Params calldata _params
    ) external virtual returns (
        uint tokenId,
        uint128 liquidity
    ) {
        if (msg.sender != strategyManager)
            revert Unauthorized();

        return _addLiquidityV3(_params);
    }

    function _addLiquidityV3(
        AddLiquidityV3Params calldata _params
    ) internal virtual returns (
        uint tokenId,
        uint128 liquidity
    ) {
        uint initialBalanceInputToken = _params.inputToken.balanceOf(address(this));

        uint amountToken0 = _zap(
            _params.swapToken0,
            _params.inputToken,
            _params.token0,
            _params.swapAmountToken0
        );
        uint amountToken1 = _zap(
            _params.swapToken1,
            _params.inputToken,
            _params.token1,
            _params.swapAmountToken1
        );

        if (_params.inputToken != _params.token0 && _params.inputToken != _params.token1)
            _updateDust(_params.inputToken, initialBalanceInputToken);

        _params.token0.safeIncreaseAllowance(address(_params.positionManager), amountToken0);
        _params.token1.safeIncreaseAllowance(address(_params.positionManager), amountToken1);

        uint initialBalanceToken0 = _params.token0.balanceOf(address(this));
        uint initialBalanceToken1 = _params.token1.balanceOf(address(this));

        (tokenId, liquidity,,) = _params.positionManager.mint(INonfungiblePositionManager.MintParams({
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
        }));

        _updateDust(_params.token0, initialBalanceToken0);
        _updateDust(_params.token1, initialBalanceToken1);
    }
}
