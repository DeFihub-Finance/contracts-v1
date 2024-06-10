// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ICall} from  "../interfaces/ICall.sol";
import {IBeefyVaultV7} from '../interfaces/IBeefyVaultV7.sol';
import {DollarCostAverage} from '../DollarCostAverage.sol';
import {VaultManager} from '../VaultManager.sol';
import {LiquidityManager} from "../LiquidityManager.sol";
import {ZapManager} from "../zap/ZapManager.sol";

library InvestLib {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    error InvalidParamsLength();

    struct DcaInvestment {
        uint208 poolId;
        uint16 swaps;
        uint8 percentage;
    }

    struct VaultInvestment {
        address vault;
        uint8 percentage;
    }

    struct LiquidityInvestment {
        address positionManager;
        address token0;
        address token1;
        uint24 fee;
        uint16 pricePercentageThresholdBelow;
        uint16 pricePercentageThresholdAbove;
        uint8 percentage;
    }

    struct DcaInvestmentParams {
        DollarCostAverage dca;
        DcaInvestment[] dcaInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        ZapManager zapManager;
        bytes[] swaps;
    }

    struct VaultInvestmentParams {
        VaultManager vaultManager;
        VaultInvestment[] vaultInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        ZapManager zapManager;
        bytes[] swaps;
    }

    struct LiquidityZapParams {
        bytes swapToken0;
        bytes swapToken1;
        uint swapAmountToken0;
        uint swapAmountToken1;
        int24 tickLower;
        int24 tickUpper;
        uint amount0Min;
        uint amount1Min;
        bytes zapToken0;
        bytes zapToken1;
    }

    struct LiquidityInvestParams {
        LiquidityManager liquidityManager;
        LiquidityInvestment[] liquidityInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        LiquidityZapParams[] zaps;
    }

    struct VaultPosition {
        address vault;
        uint amount;
    }

    struct LiquidityPosition {
        address positionManager;
        uint tokenId;
    }

    function investInDca(
        DcaInvestmentParams memory _params
    ) public returns (uint[] memory) {
        if (_params.dcaInvestments.length == 0)
            return new uint[](0);

        if (_params.dcaInvestments.length != _params.swaps.length)
            revert InvalidParamsLength();

        uint[] memory dcaPositionIds = new uint[](_params.dcaInvestments.length);
        uint nextDcaPositionId = _params.dca.getPositionsLength(address(this));

        for (uint i; i < _params.dcaInvestments.length; ++i) {
            DcaInvestment memory investment = _params.dcaInvestments[i];
            IERC20Upgradeable poolInputToken = IERC20Upgradeable(_params.dca.getPool(investment.poolId).inputToken);

            uint swapOutput = _params.zapManager.zap(
                _params.swaps[i],
                _params.inputToken,
                poolInputToken,
                _params.amount * investment.percentage / 100
            );

            poolInputToken.safeIncreaseAllowance(address(_params.dca), swapOutput);

            _params.dca.depositUsingStrategy(investment.poolId, investment.swaps, swapOutput);

            dcaPositionIds[i] = nextDcaPositionId;
            ++nextDcaPositionId;
        }

        return dcaPositionIds;
    }

    function investInVaults(
        VaultInvestmentParams memory _params
    ) public returns (VaultPosition[] memory) {
        if (_params.vaultInvestments.length == 0)
            return new VaultPosition[](0);

        if (_params.vaultInvestments.length != _params.swaps.length)
            revert InvalidParamsLength();

        VaultPosition[] memory vaultPositions = new VaultPosition[](_params.vaultInvestments.length);

        for (uint i; i < _params.vaultInvestments.length; ++i) {
            VaultInvestment memory investment = _params.vaultInvestments[i];
            IBeefyVaultV7 vault = IBeefyVaultV7(investment.vault);
            IERC20Upgradeable vaultWantToken = vault.want();

            uint swapOutput = _params.zapManager.zap(
                _params.swaps[i],
                _params.inputToken,
                vaultWantToken,
                _params.amount * investment.percentage / 100
            );

            vaultWantToken.safeIncreaseAllowance(address(_params.vaultManager), swapOutput);

            uint initialBalance = vault.balanceOf(address(this));
            _params.vaultManager.depositUsingStrategy(investment.vault, swapOutput);
            vaultPositions[i] = VaultPosition(
                investment.vault,
                vault.balanceOf(address(this)) - initialBalance
            );
        }

        return vaultPositions;
    }

    function investInLiquidity(
        LiquidityInvestParams memory _params
    ) public returns (LiquidityPosition[] memory) {
        if (_params.liquidityInvestments.length == 0)
            return new LiquidityPosition[](0);

        if (_params.liquidityInvestments.length != _params.zaps.length)
            revert InvalidParamsLength();

        LiquidityPosition[] memory liquidityPositions = new LiquidityPosition[](_params.liquidityInvestments.length);

        for (uint i; i < _params.liquidityInvestments.length; ++i) {
            // TODO
        }

        // TODO track dust and send to treasury

        return liquidityPositions;
    }

    /**
     * @param _swapOrZap - Encoded version of ZapManager.ProtocolCall
     * @param _inputToken - Token to be sold
     * @param _outputToken - Token to be bought
     * @param _amount - Amount of input tokens to be sold
     * @return Amount of output tokens bought, if no zap is needed, returns input token amount
     */
    function _zap(
        address _zapManager,
        bytes memory _swapOrZap,
        IERC20Upgradeable _inputToken,
        IERC20Upgradeable _outputToken,
        uint _amount
    ) internal returns (uint) {
        if (_swapOrZap.length > 1 && _inputToken != _outputToken) {
            _inputToken.safeTransfer(_zapManager, _amount);

            uint initialBalance = _outputToken.balanceOf(address(this));

            (bool success, bytes memory data) = _zapManager.call(_swapOrZap);

            if (!success)
                revert ICall.LowLevelCallFailed(_zapManager, _swapOrZap, data);

            return _outputToken.balanceOf(address(this)) - initialBalance;
        }

        return _amount;
    }
}
