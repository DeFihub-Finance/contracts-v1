// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {INonfungiblePositionManager} from '../interfaces/INonfungiblePositionManager.sol';

library PairHelpers {
    struct Pair {
        address token0;
        address token1;
    }

    function getBalances(
        Pair memory _pair,
        address _owner
    ) internal view returns (uint balance0, uint balance1) {
        balance0 = IERC20Upgradeable(_pair.token0).balanceOf(_owner);
        balance1 = IERC20Upgradeable(_pair.token1).balanceOf(_owner);
    }

    function fromLiquidityToken(
        INonfungiblePositionManager _positionManager,
        uint _tokenId
    ) internal view returns (Pair memory pair) {
        (,, address token0, address token1,,,,,,,,) = _positionManager.positions(_tokenId);

        return Pair(token0, token1);
    }
}
