// SPDX-License-Identifier: MIT

pragma solidity 0.8.26;

import {Ownable} from '@openzeppelin/contracts/access/Ownable.sol';
import {ERC1967Proxy} from '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';
import {GenericDeployer} from './GenericDeployer.sol';
import {SubscriptionManager} from '../SubscriptionManager.sol';
import {StrategyManager} from '../StrategyManager.sol';
import {DollarCostAverage} from '../DollarCostAverage.sol';
import {VaultManager} from '../VaultManager.sol';
import {LiquidityManager} from '../LiquidityManager.sol';
import {BuyProduct} from '../BuyProduct.sol';

contract ProjectDeployer is GenericDeployer {
    // Strategies
    address public strategyInvestor;
    address public strategyPositionManager;
    ProxyAddress public strategyManager;

    // Products
    ProxyAddress public dca;
    ProxyAddress public vaultManager;
    ProxyAddress public liquidityManager;
    ProxyAddress public buyProduct;

    // Helpers
    ProxyAddress public subscriptionManager;

    function deployStrategyInvestor(
        bytes memory _code,
        bytes32 _salt
    ) external onlyOwner {
        strategyInvestor = deploy(_code, _salt);
    }

    function deployStrategyPositionManager(
        bytes memory _code,
        bytes32 _salt
    ) external onlyOwner {
        strategyPositionManager = deploy(_code, _salt);
    }

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

    function deployLiquidityManager(
        ProxyDeploymentInfo calldata _liquidityManagerDeploymentInfo
    ) external onlyOwner {
        liquidityManager = deployProxy(_liquidityManagerDeploymentInfo);
    }

    function deployBuyProduct(
        ProxyDeploymentInfo calldata _buyProductDeploymentInfo
    ) external onlyOwner {
        buyProduct = deployProxy(_buyProductDeploymentInfo);
    }

    function initializeProject(
        SubscriptionManager.InitializeParams memory _subscriptionManagerParams,
        StrategyManager.InitializeParams memory _strategyManagerParam,
        DollarCostAverage.InitializeParams memory _dcaParams,
        VaultManager.InitializeParams memory _vaultManagerParams,
        LiquidityManager.InitializeParams memory _liquidityManagerParams,
        BuyProduct.InitializeParams memory _buyProductParams
    ) external onlyOwner {
        StrategyManager(strategyManager.proxy).initialize(_strategyManagerParam);

        // Products
        DollarCostAverage(dca.proxy).initialize(_dcaParams);
        VaultManager(vaultManager.proxy).initialize(_vaultManagerParams);
        LiquidityManager(liquidityManager.proxy).initialize(_liquidityManagerParams);
        BuyProduct(buyProduct.proxy).initialize(_buyProductParams);

        // Helpers
        SubscriptionManager(subscriptionManager.proxy).initialize(_subscriptionManagerParams);
    }
}
