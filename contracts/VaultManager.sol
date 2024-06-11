// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IBeefyVaultV7} from "./interfaces/IBeefyVaultV7.sol";
import {HubOwnable} from "./abstract/HubOwnable.sol";
import {OnlyStrategyManager} from "./abstract/OnlyStrategyManager.sol";
import {UseFee} from "./abstract/UseFee.sol";
import {SubscriptionManager} from "./SubscriptionManager.sol";

contract VaultManager is HubOwnable, UseFee, OnlyStrategyManager {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeERC20Upgradeable for IBeefyVaultV7;

    struct InitializeParams {
        address owner;
        address treasury;
        address strategyManager;
        address subscriptionManager;
        uint32 baseFeeBP;
        uint32 nonSubscriberFeeBP;
    }

    mapping(address => bool) public whitelistedVaults;
    address[] public _vaultArray;

    event Deposit(address vault, address user, uint amount);
    event VaultWhitelisted(address vault, bool whitelisted);

    error VaultNotWhitelisted();

    function initialize(InitializeParams calldata _initializeParams) public initializer {
        __Ownable_init();
        __UseFee_init(
            _initializeParams.treasury,
            _initializeParams.subscriptionManager,
            _initializeParams.baseFeeBP,
            _initializeParams.nonSubscriberFeeBP
        );
        __OnlyStrategyManager_init(_initializeParams.strategyManager);

        transferOwnership(_initializeParams.owner);
    }

    function deposit(
        address _vault,
        uint _amount,
        SubscriptionManager.Permit calldata _permit
    ) external {
        IERC20Upgradeable want = IBeefyVaultV7(_vault).want();

        uint depositFee = _collectProtocolFees(
            address(want),
            _amount,
            abi.encode(_vault),
            _permit
        );

        _deposit(_vault, _amount - depositFee);
    }

    function depositUsingStrategy(
        address _vault,
        uint _amount
    ) external virtual onlyStrategyManager {
        _deposit(_vault, _amount);
    }

    function _deposit(address _vault, uint _amount) internal virtual {
        if (!whitelistedVaults[_vault])
            revert VaultNotWhitelisted();

        IBeefyVaultV7 vault = IBeefyVaultV7(_vault);
        IERC20Upgradeable want = vault.want();

        uint balanceBefore = want.balanceOf(address(this));

        want.safeTransferFrom(msg.sender, address(this), _amount);

        uint depositAmount = want.balanceOf(address(this)) - balanceBefore;

        want.safeIncreaseAllowance(_vault, depositAmount);
        vault.deposit(depositAmount);
        vault.safeTransfer(msg.sender, vault.balanceOf(address(this)));

        emit Deposit(_vault, msg.sender, depositAmount);
    }

    function setVaultWhitelistStatus(address _vault, bool _whitelisted) external virtual onlyOwner {
        if (_whitelisted && !whitelistedVaults[_vault])
            _vaultArray.push(_vault);

        whitelistedVaults[_vault] = _whitelisted;

        emit VaultWhitelisted(_vault, _whitelisted);
    }

    function getVaultsLength() external virtual view returns (uint) {
        return _vaultArray.length;
    }

    function getVault(uint _index) external virtual view returns (address vault, bool whitelisted) {
        return (_vaultArray[_index], whitelistedVaults[_vaultArray[_index]]);
    }

    // @dev Returns an array of vaults that are whitelisted. The array is the same length
    // as the _vaultArray, but filled with 0x0 for non-whitelisted vaults.
    function getWhitelistedVaults() external virtual view returns (address[] memory) {
        address[] memory vaultArray = new address[](_vaultArray.length);

        for (uint i; i < _vaultArray.length; ++i) {
            address vault = _vaultArray[i];

            if (whitelistedVaults[vault])
                vaultArray[i] = _vaultArray[i];
        }

        return vaultArray;
    }
}
