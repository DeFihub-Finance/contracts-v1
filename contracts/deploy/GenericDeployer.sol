// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {ERC1967Proxy} from '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';

contract GenericDeployer is Ownable {
    struct ProxyDeploymentInfo {
        bytes code;
        bytes32 implementationSalt;
        bytes32 proxySalt;
    }

    struct ProxyAddress {
        address implementation;
        address proxy;
    }

    function deploy(
        bytes memory _code,
        bytes32 _salt
    ) public onlyOwner returns (address addr) {
        assembly {
            addr := create2(0, add(_code, 0x20), mload(_code), _salt)
            if iszero(extcodesize(addr)) {revert(0, 0)}
        }
    }

    function deployProxy(
        ProxyDeploymentInfo calldata _deployInfo
    ) public onlyOwner returns (ProxyAddress memory)  {
        address implementation = deploy(_deployInfo.code, _deployInfo.implementationSalt);
        address proxy = deploy(
            abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(implementation, "")
            ),
            _deployInfo.proxySalt
        );

        return ProxyAddress(implementation, proxy);
    }

    function getDeployAddress(
        bytes memory _code,
        bytes32 _salt
    ) public view returns (address) {
        bytes32 initCodeHash = keccak256(_code);
        bytes32 data = keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            _salt,
            initCodeHash
        ));
        return address(uint160(uint256(data)));
    }

    function getDeployProxyAddress(
        ProxyDeploymentInfo calldata _deploymentInfo
    ) public view returns (ProxyAddress memory) {
        address implementation = getDeployAddress(
            _deploymentInfo.code,
            _deploymentInfo.implementationSalt
        );

        return ProxyAddress({
            proxy: getDeployAddress(
                abi.encodePacked(
                    type(ERC1967Proxy).creationCode,
                    abi.encode(implementation, "")
                ),
                _deploymentInfo.proxySalt
            ),
            implementation: implementation
        });
    }
}
