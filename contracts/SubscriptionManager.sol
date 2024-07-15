// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ECDSAUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {HubOwnable} from "./abstract/HubOwnable.sol";
import {UseTreasury} from "./abstract/UseTreasury.sol";

contract SubscriptionManager is HubOwnable, UseTreasury, EIP712Upgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct InitializeParams {
        address owner;
        address treasury;
        address subscriptionSigner;
        IERC20Upgradeable token;
        uint pricePerMonth;
    }

    struct Permit {
        // deadline isn't the same as a subscription end date, it's just a deadline for the signature
        uint deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    bytes32 private constant _PERMIT_TYPEHASH = keccak256("SubscriptionPermit(address user,uint256 deadline)");

    address public subscriptionSigner;
    IERC20Upgradeable public token;

    uint public pricePerMonth;
    uint constant public ONE_MONTH = 30 days;

    event Subscribed(address user);
    event SubscriptionSignerUpdated(address subscriptionSigner);
    event PricePerMonthUpdated(uint pricePerMonth);

    error InvalidSignature();
    error SubscriptionExpired();
    error InvalidSubscriberFee();

    function initialize(InitializeParams calldata _initializeParams) initializer public {
        __Ownable_init();
        __EIP712_init_unchained('defihub.fi', "1");

        setTreasury(_initializeParams.treasury);
        transferOwnership(_initializeParams.owner);

        subscriptionSigner = _initializeParams.subscriptionSigner;
        token = _initializeParams.token;
        pricePerMonth = _initializeParams.pricePerMonth;
    }

    function subscribe() external virtual {
        token.safeTransferFrom(msg.sender, treasury, getCost());

        emit Subscribed(msg.sender);
    }

    function getCost() public virtual view returns (uint) {
        return pricePerMonth * 12;
    }

    function isSubscribed(address _user, Permit calldata _permit) external virtual view returns (bool) {
        if (_user == address(0) || _permit.deadline == 0)
            return false;

        if (_permit.deadline < block.timestamp)
            revert SubscriptionExpired();

        bytes32 structHash = keccak256(abi.encode(_PERMIT_TYPEHASH, _user, _permit.deadline));
        bytes32 hash = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSAUpgradeable.recover(hash, _permit.v, _permit.r, _permit.s);

        if (recoveredSigner != subscriptionSigner)
            revert InvalidSignature();

        return true;
    }

    function setSubscriptionSigner(address _subscriptionSigner) external virtual onlyOwner {
        subscriptionSigner = _subscriptionSigner;

        emit SubscriptionSignerUpdated(_subscriptionSigner);
    }

    function setSubscriptionPrice(uint _pricePerMonth) external virtual onlyOwner {
        pricePerMonth = _pricePerMonth;

        emit PricePerMonthUpdated(_pricePerMonth);
    }
}
