// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./IBeefyStrategy.sol";

contract BeefyMockStrategy is IBeefyStrategy, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable public override want;
    address public override vault;

    // Modifier to ensure that only the vault can call certain functions
    modifier onlyVault() {
        require(msg.sender == vault, "Caller is not the vault");
        _;
    }

    function initialize(address _vault, IERC20Upgradeable _want) public initializer {
        __Ownable_init();
        vault = _vault;
        want = _want;
    }

    function beforeDeposit() external override onlyVault {}

    function deposit() external override onlyVault {
        // No-op, since this strategy does not actively manage the assets
    }

    function withdraw(uint256 _amount) external override onlyVault {
        want.safeTransfer(vault, _amount);
    }

    function balanceOf() external view override returns (uint256) {
        return want.balanceOf(address(this));
    }

    function balanceOfWant() external view override returns (uint256) {
        return want.balanceOf(address(this));
    }

    function balanceOfPool() external pure override returns (uint256) {
        // Since this strategy does not actively invest the funds, balance in the "pool" is always 0
        return 0;
    }

    function harvest() external override {
        // No-op, as there are no earnings to harvest in this strategy
    }

    function retireStrat() public override onlyVault {
        // Transfer all held tokens back to the vault
        want.safeTransfer(vault, want.balanceOf(address(this)));
    }

    function panic() external override onlyVault {
        // Pause the strategy and withdraw all funds to the vault in case of an emergency
        retireStrat();
    }

    function pause() public override onlyOwner {
    }

    function unpause() external override onlyOwner {
    }

    function paused() public view virtual returns (bool) {
        return false;
    }

    function unirouter() external pure override returns (address) {
        // This strategy does not use a Uniswap router
        return address(0);
    }
}
