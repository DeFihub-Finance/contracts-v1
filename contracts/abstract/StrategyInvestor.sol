// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IBeefyVaultV7} from '../interfaces/IBeefyVaultV7.sol';
import {HubRouter} from "../libraries/HubRouter.sol";
import {VaultManager} from '../VaultManager.sol';
import {LiquidityManager} from "../LiquidityManager.sol";
import {StrategyStorage} from "./StrategyStorage.sol";
import {SubscriptionManager} from "../SubscriptionManager.sol";
import {UseFee} from "./UseFee.sol";

contract StrategyInvestor is StrategyStorage {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    error InvalidParamsLength();
    error InsufficientFunds();

    struct DcaInvestParams {
        DcaInvestment[] dcaInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        bytes[] swaps;
    }

    struct VaultInvestParams {
        VaultInvestment[] vaultInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        bytes[] swaps;
    }

    /// part of LiquidityInvestParams
    struct LiquidityInvestZapParams {
        bytes swapToken0;
        bytes swapToken1;
        uint swapAmountToken0;
        uint swapAmountToken1;
        int24 tickLower;
        int24 tickUpper;
        uint amount0Min;
        uint amount1Min;
    }

    struct LiquidityInvestParams {
        LiquidityInvestment[] investments;
        IERC20Upgradeable inputToken;
        uint amount;
        uint8 liquidityTotalPercentage;
        LiquidityInvestZapParams[] zaps;
    }

    struct BuyInvestParams {
        BuyInvestment[] investments;
        IERC20Upgradeable inputToken;
        uint amount;
        bytes[] swaps;
    }

    struct CollectFeesParams {
        uint strategyId;
        uint stableAmount;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
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
        LiquidityInvestZapParams[] liquidityZaps;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
    }

    struct InvestNativeParams {
        uint strategyId;
        bytes inputTokenSwap;
        bytes[] dcaSwaps;
        bytes[] vaultSwaps;
        bytes[] buySwaps;
        LiquidityInvestZapParams[] liquidityZaps;
        SubscriptionManager.Permit investorPermit;
        SubscriptionManager.Permit strategistPermit;
    }

    error StrategyUnavailable();

    function invest(InvestParams memory _params) external {
        if (_params.strategyId > _strategies.length)
            revert StrategyUnavailable();

        uint initialInputTokenBalance = _params.inputToken.balanceOf(address(this));

        _params.inputToken.safeTransferFrom(msg.sender, address(this), _params.inputAmount);

        _invest(
            _params,
            HubRouter.execute(
                _params.inputTokenSwap,
                _params.inputToken,
                stable,
                _params.inputToken.balanceOf(address(this)) - initialInputTokenBalance
            )
        );
    }

    function investNative(InvestNativeParams memory _params) external payable {
        if (_params.strategyId > _strategies.length)
            revert StrategyUnavailable();

        _invest(
            InvestParams({
                strategyId: _params.strategyId,
                inputToken: IERC20Upgradeable(address(0)),
                inputAmount: msg.value,
                inputTokenSwap: '',
                dcaSwaps: _params.dcaSwaps,
                vaultSwaps: _params.vaultSwaps,
                buySwaps: _params.buySwaps,
                liquidityZaps: _params.liquidityZaps,
                investorPermit: _params.investorPermit,
                strategistPermit: _params.strategistPermit
            }),
            HubRouter.executeNative(_params.inputTokenSwap, stable)
        );
    }

    function _invest(
        InvestParams memory _investParams,
        uint stableAmount
    ) internal {
        Strategy storage strategy = _strategies[_investParams.strategyId];

        uint stableAmountAfterFees = _collectFees(
            CollectFeesParams({
                strategyId: _investParams.strategyId,
                stableAmount: stableAmount,
                investorPermit: _investParams.investorPermit,
                strategistPermit: _investParams.strategistPermit
            })
        );

        uint[] memory dcaPositionIds = _investInDca(
            DcaInvestParams({
                dcaInvestments: _dcaInvestmentsPerStrategy[_investParams.strategyId],
                inputToken: stable,
                amount: stableAmountAfterFees,
                swaps: _investParams.dcaSwaps
            })
        );

        VaultPosition[] memory vaultPositions = _investInVaults(
            VaultInvestParams({
                vaultInvestments: _vaultInvestmentsPerStrategy[_investParams.strategyId],
                inputToken: stable,
                amount: stableAmountAfterFees,
                swaps: _investParams.vaultSwaps
            })
        );

        LiquidityPosition[] memory liquidityPositions = _investInLiquidity(
            LiquidityInvestParams({
                investments: _liquidityInvestmentsPerStrategy[_investParams.strategyId],
                inputToken: stable,
                amount: stableAmountAfterFees,
                liquidityTotalPercentage: strategy.percentages[PRODUCT_LIQUIDITY],
                zaps: _investParams.liquidityZaps
            })
        );

        BuyPosition[] memory buyPositions = _investInToken(
            BuyInvestParams({
                investments: _buyInvestmentsPerStrategy[_investParams.strategyId],
                inputToken: stable,
                amount: stableAmountAfterFees,
                swaps: _investParams.buySwaps
            })
        );

        uint positionId = _positions[msg.sender].length;

        Position storage position = _positions[msg.sender].push();

        position.strategyId = _investParams.strategyId;
        _dcaPositionsPerPosition[msg.sender][positionId] = dcaPositionIds;

        for (uint i; i < vaultPositions.length; ++i)
            _vaultPositionsPerPosition[msg.sender][positionId].push(vaultPositions[i]);

        for (uint i; i < liquidityPositions.length; ++i)
            _liquidityPositionsPerPosition[msg.sender][positionId].push(liquidityPositions[i]);

        for (uint i; i < buyPositions.length; ++i)
            _buyPositionsPerPosition[msg.sender][positionId].push(buyPositions[i]);

        emit PositionCreated(
            msg.sender,
            _investParams.strategyId,
            positionId,
            address(_investParams.inputToken),
            _investParams.inputAmount,
            stableAmountAfterFees,
            dcaPositionIds,
            vaultPositions,
            liquidityPositions,
            buyPositions
        );
    }

    function _investInDca(
        DcaInvestParams memory _params
    ) private returns (uint[] memory) {
        if (_params.dcaInvestments.length == 0)
            return new uint[](0);

        if (_params.dcaInvestments.length != _params.swaps.length)
            revert InvalidParamsLength();

        uint[] memory dcaPositionIds = new uint[](_params.dcaInvestments.length);
        uint nextDcaPositionId = dca.getPositionsLength(address(this));

        for (uint i; i < _params.dcaInvestments.length; ++i) {
            DcaInvestment memory investment = _params.dcaInvestments[i];
            IERC20Upgradeable poolInputToken = IERC20Upgradeable(dca.getPool(investment.poolId).inputToken);

            uint swapOutput = HubRouter.execute(
                _params.swaps[i],
                _params.inputToken,
                poolInputToken,
                _params.amount * investment.percentage / 100
            );

            poolInputToken.safeTransfer(address(dca), swapOutput);

            dca.investUsingStrategy(investment.poolId, investment.swaps, swapOutput);

            dcaPositionIds[i] = nextDcaPositionId;
            ++nextDcaPositionId;
        }

        return dcaPositionIds;
    }

    function _investInVaults(
        VaultInvestParams memory _params
    ) private returns (VaultPosition[] memory) {
        if (_params.vaultInvestments.length == 0)
            return new VaultPosition[](0);

        if (_params.vaultInvestments.length != _params.swaps.length)
            revert InvalidParamsLength();

        VaultPosition[] memory vaultPositions = new VaultPosition[](_params.vaultInvestments.length);

        for (uint i; i < _params.vaultInvestments.length; ++i) {
            VaultInvestment memory investment = _params.vaultInvestments[i];
            IBeefyVaultV7 vault = IBeefyVaultV7(investment.vault);
            IERC20Upgradeable vaultWantToken = vault.want();

            uint swapOutput = HubRouter.execute(
                _params.swaps[i],
                _params.inputToken,
                vaultWantToken,
                _params.amount * investment.percentage / 100
            );

            vaultWantToken.safeTransfer(address(vaultManager), swapOutput);

            uint initialBalance = vault.balanceOf(address(this));
            vaultManager.investUsingStrategy(investment.vault, swapOutput);
            vaultPositions[i] = VaultPosition(
                investment.vault,
                vault.balanceOf(address(this)) - initialBalance
            );
        }

        return vaultPositions;
    }

    function _investInLiquidity(
        LiquidityInvestParams memory _params
    ) private returns (LiquidityPosition[] memory) {
        if (_params.investments.length == 0)
            return new LiquidityPosition[](0);

        if (_params.investments.length != _params.zaps.length)
            revert InvalidParamsLength();

        LiquidityPosition[] memory liquidityPositions = new LiquidityPosition[](_params.investments.length);

        _params.inputToken.safeTransfer(
            address(liquidityManager),
            _params.liquidityTotalPercentage * _params.amount / 100
        );

        for (uint i; i < _params.investments.length; ++i) {
            LiquidityInvestment memory investment = _params.investments[i];
            LiquidityInvestZapParams memory zap = _params.zaps[i];
            uint currentInvestmentAmount = _params.amount * investment.percentage / 100;

            if (zap.swapAmountToken0 + zap.swapAmountToken1 > currentInvestmentAmount)
                revert InsufficientFunds();

            (uint tokenId, uint128 liquidity) = liquidityManager.investUniswapV3UsingStrategy(
                LiquidityManager.InvestUniswapV3Params({
                    positionManager: address(investment.positionManager),
                    inputToken: _params.inputToken,
                    depositAmountInputToken: currentInvestmentAmount,
                    token0: investment.token0,
                    token1: investment.token1,
                    fee: investment.fee,
                    swapToken0: zap.swapToken0,
                    swapToken1: zap.swapToken1,
                    swapAmountToken0: zap.swapAmountToken0,
                    swapAmountToken1: zap.swapAmountToken1,
                    tickLower: zap.tickLower,
                    tickUpper: zap.tickUpper,
                    amount0Min: zap.amount0Min,
                    amount1Min: zap.amount1Min
                })
            );

            liquidityPositions[i] = LiquidityPosition(
                investment.positionManager,
                tokenId,
                liquidity
            );
        }

        return liquidityPositions;
    }

    function _investInToken(
        BuyInvestParams memory _params
    ) private returns (BuyPosition[] memory) {
        if (_params.swaps.length == 0)
            return new BuyPosition[](0);

        BuyPosition[] memory buyPositions = new BuyPosition[](_params.swaps.length);

        for (uint i; i < _params.swaps.length; ++i) {
            BuyInvestment memory investment = _params.investments[i];

            uint swapOutput = HubRouter.execute(
                _params.swaps[i],
                _params.inputToken,
                investment.token,
                _params.amount * investment.percentage / 100
            );

            buyPositions[i] = BuyPosition(investment.token, swapOutput);
        }

        return buyPositions;
    }

    function _collectFees(
        CollectFeesParams memory _params
    ) internal virtual returns (uint remainingAmount) {
        Strategy storage strategy = _strategies[_params.strategyId];

        bool strategistSubscribed = subscriptionManager.isSubscribed(strategy.creator, _params.strategistPermit);
        bool userSubscribed = subscriptionManager.isSubscribed(msg.sender, _params.investorPermit);

        // Divided by multiplier 10_000 (fee percentage) * 100 (strategy percentage per investment) = 1M
        uint totalFee = _params.stableAmount * (
            _getProductFee(strategy.percentages[PRODUCT_DCA], dca, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_VAULTS], vaultManager, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_LIQUIDITY], liquidityManager, userSubscribed)
            + _getProductFee(strategy.percentages[PRODUCT_BUY], buyProduct, userSubscribed)
        ) / 1_000_000;
        uint strategistFee;

        if (strategistSubscribed) {
            uint currentStrategistPercentage = _hottestStrategiesMapping[_params.strategyId]
                ? hotStrategistPercentage
                : strategistPercentage;

            strategistFee = totalFee * currentStrategistPercentage / 100;
        }

        uint protocolFee = totalFee - strategistFee;

        stable.safeTransfer(treasury, protocolFee);

        if (strategistFee > 0) {
            _strategistRewards[strategy.creator] += strategistFee;

            emit Fee(msg.sender, strategy.creator, strategistFee, abi.encode(_params.strategyId));
        }

        emit Fee(msg.sender, treasury, protocolFee, abi.encode(_params.strategyId));

        return _params.stableAmount - totalFee;
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
}
