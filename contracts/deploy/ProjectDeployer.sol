// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {ERC1967Proxy} from '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';
import {GenericDeployer} from './GenericDeployer.sol';
import {SubscriptionManager} from '../SubscriptionManager.sol';
import {StrategyManager} from '../StrategyManager.sol';
import {DollarCostAverage} from '../DollarCostAverage.sol';
import {VaultManager} from '../VaultManager.sol';
import {ZapManager} from '../zap/ZapManager.sol';

contract ProjectDeployer is GenericDeployer {
    ProxyAddress public subscriptionManager;
    ProxyAddress public strategyManager;
    ProxyAddress public dca;
    ProxyAddress public vaultManager;
    ProxyAddress public zapManager;

    function deployStrategyManager(
        ProxyDeploymentInfo calldata _strategyManagerDeploymentInfo
    ) external onlyOwner {
        strategyManager = deployProxy(_strategyManagerDeploymentInfo);
    }

    function deploySubscriptionManager(
        ProxyDeploymentInfo calldata _subscriptionManagerDeploymentInfo
    ) external onlyOwner {
        subscriptionManager = deployProxy(_subscriptionManagerDeploymentInfo);
    }

    function deployDca(
        ProxyDeploymentInfo calldata _dcaDeploymentInfo
    ) external onlyOwner {
        dca = deployProxy(_dcaDeploymentInfo);
    }

    function deployVaultManager(
        ProxyDeploymentInfo calldata _vaultManagerDeploymentInfo
    ) external onlyOwner {
        vaultManager = deployProxy(_vaultManagerDeploymentInfo);
    }

    function deployZapManager(
        ProxyDeploymentInfo calldata _zapManagerInfo
    ) external onlyOwner {
        zapManager = deployProxy(_zapManagerInfo);
    }

    function initializeProject(
        SubscriptionManager.InitializeParams memory _subscriptionManagerParams,
        StrategyManager.InitializeParams memory _strategyManagerParam,
        DollarCostAverage.InitializeParams memory _dcaParams,
        VaultManager.InitializeParams memory _vaultManagerParams,
        ZapManager.InitializeParams memory _zapManagerParams
    ) external onlyOwner {
        SubscriptionManager(subscriptionManager.proxy).initialize(_subscriptionManagerParams);

        _strategyManagerParam.subscriptionManager = SubscriptionManager(subscriptionManager.proxy);
        _strategyManagerParam.dca = DollarCostAverage(dca.proxy);
        _strategyManagerParam.vaultManager = VaultManager(vaultManager.proxy);
        _strategyManagerParam.zapManager = ZapManager(zapManager.proxy);
        StrategyManager(strategyManager.proxy).initialize(_strategyManagerParam);

        _dcaParams.subscriptionManager = subscriptionManager.proxy;
        _dcaParams.strategyManager = strategyManager.proxy;
        DollarCostAverage(dca.proxy).initialize(_dcaParams);

        _vaultManagerParams.subscriptionManager = subscriptionManager.proxy;
        _vaultManagerParams.strategyManager = strategyManager.proxy;
        VaultManager(vaultManager.proxy).initialize(_vaultManagerParams);

        ZapManager(zapManager.proxy).initialize(_zapManagerParams);
    }
}
