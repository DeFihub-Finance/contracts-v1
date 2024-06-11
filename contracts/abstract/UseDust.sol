// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

// @dev can only be used in contracts that aren't holding users' funds
abstract contract UseDust {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // @notice arbitrary number to prevent transferring insignificant amounts of tokens
    uint private constant MIN_DUST = 100;

    function _sendDust(IERC20Upgradeable _token, address _to) internal {
        uint balance = _token.balanceOf(address(this));

        // @dev using ">" instead of ">=" to save gas since the difference is negligible
        if (balance > MIN_DUST)
            _token.safeTransfer(_to, balance);
    }
}
