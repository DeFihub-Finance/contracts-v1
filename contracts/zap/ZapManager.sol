// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

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
     * @dev Encapsulates data required to perform a protocol-specific zap or swap operation.
     * @param protocolName The name of the protocol to call.
     * @param inputToken The ERC20 token to be used as input.
     * @param outputToken The ERC20 token to be received as output.
     * @param zapperFunctionSignature The function signature of the zapper's function to call.
     * @param data The encoded function signature and data to pass to the zapper function.
     *             If `data` represents a swap transaction, the recipient must be set to the address
     *             that will use the output tokens (typically the sender's address).
     *             If `data` represents a liquidity provision transaction, the recipient for the swap
     *             must be this contract's address (LiquidityManager) to ensure sufficient funds are available for liquidity provision.
     *             The minted LP tokens will then be forwarded to the intended recipient.
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

    /**
     * @notice Performs a zap operation using the specified protocol call data.
     * @param _protocolCallData - Encoded version of ZapManager.ProtocolCall
     * @param _inputToken The ERC20 token to be sold.
     * @param _outputToken The ERC20 token to be bought.
     * @param _amount - Amount of input tokens to be sold
     * @return The amount of output tokens bought. If no zap is needed, returns the input token amount.
     */
    function zap(
        bytes memory _protocolCallData,
        IERC20Upgradeable _inputToken,
        IERC20Upgradeable _outputToken,
        uint _amount
    ) external virtual returns (uint) {
        if (_protocolCallData.length > 1) {
            uint initialBalanceOutputToken = _outputToken.balanceOf(msg.sender);

            // pull tokens
            _inputToken.safeTransferFrom(msg.sender, address(this), _amount);

            // make call to external dex
            callProtocol(abi.decode(_protocolCallData, (ProtocolCall)));

            return _outputToken.balanceOf(msg.sender) - initialBalanceOutputToken;
        }

        return _amount;
    }

    function callProtocol(ProtocolCall memory _protocolCall) internal {
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
    }

    function getSupportedProtocols() external view returns (address[] memory) {
        return supportedProtocols;
    }

    /**
     * @dev This contract shouldn't hold any tokens, but some dust might get stuck when swapping or adding liquidity
     */
    function collectDust(IERC20Upgradeable[] calldata _tokens) external onlyOwner {
        for (uint i; i < _tokens.length; ++i)
            _tokens[i].safeTransfer(msg.sender, _tokens[i].balanceOf(address(this)));
    }

    function addProtocol(string memory _protocolName, address _protocolAddr) public onlyOwner {
        if (_protocolAddr == address(0))
            revert InvalidAddress(_protocolAddr);

        if (protocolImplementations[_protocolName] != address(0))
            revert DuplicateProtocol(_protocolName, _protocolAddr);

        protocolImplementations[_protocolName] = _protocolAddr;
        supportedProtocols.push(_protocolAddr);
    }
}
