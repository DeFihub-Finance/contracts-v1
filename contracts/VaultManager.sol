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

    event PositionCreated(address vault, address user, uint amount);

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

    function invest(
        address _vault,
        uint _amount,
        SubscriptionManager.Permit calldata _permit
    ) external {
        IERC20Upgradeable want = IBeefyVaultV7(_vault).want();

        _invest(
            _vault,
            _pullFunds(
                address(want),
                _amount,
                abi.encode(_vault),
                _permit
            )
        );
    }

    function investUsingStrategy(
        address _vault,
        uint _amount
    ) external virtual onlyStrategyManager {
        _invest(_vault, _amount);
    }

    function _invest(address _vault, uint _amount) internal virtual {
        IBeefyVaultV7 vault = IBeefyVaultV7(_vault);
        IERC20Upgradeable want = vault.want();

        want.safeIncreaseAllowance(_vault, _amount);
        vault.deposit(_amount);
        vault.safeTransfer(msg.sender, vault.balanceOf(address(this)));

        emit PositionCreated(_vault, msg.sender, _amount);
    }
}
