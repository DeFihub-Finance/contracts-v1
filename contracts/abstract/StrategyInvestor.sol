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

    error StrategyUnavailable();

    function invest(InvestParams memory _params) external {
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

        uint[] memory dcaPositionIds = _investInDca(
            DcaInvestParams({
                dcaInvestments: _dcaInvestmentsPerStrategy[_params.strategyId],
                inputToken: stable,
                amount: pullFundsResult.remainingAmount,
                swaps: _params.dcaSwaps
            })
        );

        VaultPosition[] memory vaultPositions = _investInVaults(
            VaultInvestParams({
                vaultInvestments: _vaultInvestmentsPerStrategy[_params.strategyId],
                inputToken: stable,
                amount: pullFundsResult.remainingAmount,
                swaps: _params.vaultSwaps
            })
        );

        LiquidityPosition[] memory liquidityPositions = _investInLiquidity(
            LiquidityInvestParams({
                investments: _liquidityInvestmentsPerStrategy[_params.strategyId],
                inputToken: stable,
                amount: pullFundsResult.remainingAmount,
                liquidityTotalPercentage: strategy.percentages[PRODUCT_LIQUIDITY],
                zaps: _params.liquidityZaps
            })
        );

        BuyPosition[] memory buyPositions = _investInToken(
            BuyInvestParams({
                investments: _buyInvestmentsPerStrategy[_params.strategyId],
                inputToken: stable,
                amount: pullFundsResult.remainingAmount,
                swaps: _params.buySwaps
            })
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

        uint stableAmount = HubRouter.execute(
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
}
