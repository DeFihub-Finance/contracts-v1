// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {INonfungiblePositionManager} from "./interfaces/INonfungiblePositionManager.sol";
import {HubOwnable} from "./abstract/HubOwnable.sol";
import {OnlyStrategyManager} from "./abstract/OnlyStrategyManager.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {UseDust} from "./abstract/UseDust.sol";
import {HubRouter} from "./libraries/HubRouter.sol";
import {SubscriptionManager} from "./SubscriptionManager.sol";

contract LiquidityManager is HubOwnable, UseFee, UseDust, OnlyStrategyManager {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct InitializeParams {
        address owner;
        address treasury;
        address subscriptionManager;
        address strategyManager;
        // @deprecated must keep variable to maintain storage layout
        address zapManager;
        uint32 baseFeeBP;
        uint32 nonSubscriberFeeBP;
    }

    struct InvestUniswapV3Params {
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

    // @deprecated must keep variable to maintain storage layout
    address public zapManager;

    event PositionCreated(address user, address positionManager, uint tokenId, uint128 liquidity);

    error InsufficientFunds(uint requested, uint available);
    error InvalidInvestment();

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

    function investUniswapV3(
        InvestUniswapV3Params calldata _params,
        SubscriptionManager.Permit calldata _subscriptionPermit
    ) external virtual returns (
        uint tokenId,
        uint128 liquidity
    ) {
        uint remainingAmount = _pullFunds(
            address(_params.inputToken),
            _params.depositAmountInputToken,
            abi.encode(_params.inputToken, _params.token0, _params.token1, _params.fee),
            _subscriptionPermit
        );

        uint requested = _params.swapAmountToken0 + _params.swapAmountToken1;

        if (requested > remainingAmount)
            revert InsufficientFunds(requested, remainingAmount);

        if (_params.token0 >= _params.token1)
            revert InvalidInvestment();

        return _investUniswapV3(_params);
    }

    function investUniswapV3UsingStrategy(
        InvestUniswapV3Params calldata _params
    ) external virtual onlyStrategyManager returns (
        uint tokenId,
        uint128 liquidity
    ) {
        return _investUniswapV3(_params);
    }

    function _investUniswapV3(
        InvestUniswapV3Params calldata _params
    ) internal virtual returns (
        uint tokenId,
        uint128 liquidity
    ) {
        uint inputAmount0 = HubRouter.execute(
            _params.swapToken0,
            _params.inputToken,
            _params.token0,
            _params.swapAmountToken0
        );
        uint inputAmount1 = HubRouter.execute(
            _params.swapToken1,
            _params.inputToken,
            _params.token1,
            _params.swapAmountToken1
        );

        _params.token0.safeIncreaseAllowance(address(_params.positionManager), inputAmount0);
        _params.token1.safeIncreaseAllowance(address(_params.positionManager), inputAmount1);

        (tokenId, liquidity,,) = INonfungiblePositionManager(_params.positionManager).mint(
            INonfungiblePositionManager.MintParams({
                token0: address(_params.token0),
                token1: address(_params.token1),
                fee: _params.fee,
                tickLower: _params.tickLower,
                tickUpper: _params.tickUpper,
                amount0Desired: inputAmount0,
                amount1Desired: inputAmount1,
                amount0Min: _params.amount0Min,
                amount1Min: _params.amount1Min,
                recipient: msg.sender,
                deadline: block.timestamp
            })
        );

        emit PositionCreated(msg.sender, _params.positionManager, tokenId, liquidity);
    }

    function sendDust(IERC20Upgradeable _token, address _to) external virtual onlyStrategyManager {
        _sendDust(_token, _to);
    }
}
