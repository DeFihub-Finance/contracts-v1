// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

library TokenHelpers {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    function currentBalance(address _token) internal view returns (uint) {
        return IERC20Upgradeable(_token).balanceOf(address(this));
    }

    function approveIfNeeded(address _token, address _spender, uint _amount) internal {
        uint allowance = IERC20Upgradeable(_token).allowance(address(this), _spender);

        if (allowance < _amount)
            IERC20Upgradeable(_token).approve(_spender, _amount);
    }
}
