// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {IERC20Upgradeable, SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {IZapper} from "./IZapper.sol";
import {UniswapV2Zapper} from "./UniswapV2Zapper.sol";
import {UniswapV3Zapper} from "./UniswapV3Zapper.sol";
import {HubOwnable} from "../abstract/HubOwnable.sol";
import {ICall} from "../interfaces/ICall.sol";

contract ZapManager is HubOwnable, ICall {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    struct InitializeParams {
        address owner;
        UniswapV2Zapper.ConstructorParams uniswapV2ZapperConstructor;
        UniswapV3Zapper.ConstructorParams uniswapV3ZapperConstructor;
    }

    /**
     * @dev data bytes are the encoded versions of the bytes argument received by "zap()" or "swap()" functions of the zappers
     */
    struct ProtocolCall {
        string protocolName;
        IERC20Upgradeable inputToken;
        IERC20Upgradeable outputToken;
        string zapperFunctionSignature;
        bytes data;
    }

    mapping(string => address) public protocolImplementations;
    address[] internal supportedProtocols;

    error UnsupportedProtocol(string protocol);
    error InvalidAddress(address addr);
    error DuplicateProtocol(string protocol, address protocolAddress);

    function initialize(InitializeParams memory _params) public initializer {
        __Ownable_init();

        addProtocol("UniswapV2", address(new UniswapV2Zapper(_params.uniswapV2ZapperConstructor)));
        addProtocol("UniswapV3", address(new UniswapV3Zapper(_params.uniswapV3ZapperConstructor)));

        transferOwnership(_params.owner);
    }

    function callProtocol(ProtocolCall memory _protocolCall) external {
        address protocolAddr = protocolImplementations[_protocolCall.protocolName];

        if (protocolAddr == address(0))
            revert UnsupportedProtocol(_protocolCall.protocolName);

        // delegate call to spare a token transfer
        (bool success, bytes memory data) = protocolAddr.delegatecall(abi.encodeWithSignature(
            _protocolCall.zapperFunctionSignature,
            (_protocolCall.data)
        ));

        if (!success)
            revert LowLevelCallFailed(protocolAddr, _protocolCall.data, data);

        uint inputTokenBalance = _protocolCall.inputToken.balanceOf(address(this));

        if (inputTokenBalance > 0)
            _protocolCall.inputToken.transfer(msg.sender, inputTokenBalance);

        _protocolCall.outputToken.transfer(
            msg.sender,
            _protocolCall.outputToken.balanceOf(address(this))
        );
    }

    function addProtocol(string memory _protocolName, address _protocolAddr) public onlyOwner {
        if (_protocolAddr == address(0))
            revert InvalidAddress(_protocolAddr);

        if (protocolImplementations[_protocolName] != address(0))
            revert DuplicateProtocol(_protocolName, _protocolAddr);

        protocolImplementations[_protocolName] = _protocolAddr;
        supportedProtocols.push(_protocolAddr);
    }

    function getSupportedProtocols() external view returns (address[] memory) {
        return supportedProtocols;
    }
}
