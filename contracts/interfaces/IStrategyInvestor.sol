// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {DollarCostAverage} from '../DollarCostAverage.sol';

// TODO improve this
interface IStrategyInvestor {
    struct DcaInvestment {
        uint208 poolId;
        uint16 swaps;
        uint8 percentage;
    }

    struct DcaInvestmentParams {
        DollarCostAverage dca;
        DcaInvestment[] dcaInvestments;
        IERC20Upgradeable inputToken;
        uint amount;
        address zapManager;
        bytes[] swaps;
    }

    error InvalidSwapsLength();
}
