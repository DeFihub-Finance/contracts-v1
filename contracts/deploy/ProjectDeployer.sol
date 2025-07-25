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

    function deploySubscriptionManager(
        ProxyDeploymentInfo calldata _subscriptionManagerDeploymentInfo,
        SubscriptionManager.InitializeParams memory _subscriptionManagerParams
    ) external onlyOwner {
        subscriptionManager = deployProxy(_subscriptionManagerDeploymentInfo);
        SubscriptionManager(subscriptionManager.proxy).initialize(_subscriptionManagerParams);
    }

    function deployStrategyManager(
        ProxyDeploymentInfo calldata _strategyManagerDeploymentInfo,
        StrategyManager.InitializeParams memory _strategyManagerParam
    ) external onlyOwner {
        strategyManager = deployProxy(_strategyManagerDeploymentInfo);
        StrategyManager(strategyManager.proxy).initialize(_strategyManagerParam);
    }

    function deployDca(
        ProxyDeploymentInfo calldata _dcaDeploymentInfo,
        DollarCostAverage.InitializeParams memory _dcaParams
    ) external onlyOwner {
        dca = deployProxy(_dcaDeploymentInfo);
        DollarCostAverage(dca.proxy).initialize(_dcaParams);
    }

    function deployVaultManager(
        ProxyDeploymentInfo calldata _vaultManagerDeploymentInfo,
        VaultManager.InitializeParams memory _vaultManagerParams
    ) external onlyOwner {
        vaultManager = deployProxy(_vaultManagerDeploymentInfo);
        VaultManager(vaultManager.proxy).initialize(_vaultManagerParams);
    }

    function deployLiquidityManager(
        ProxyDeploymentInfo calldata _liquidityManagerDeploymentInfo,
        LiquidityManager.InitializeParams memory _liquidityManagerParams
    ) external onlyOwner {
        liquidityManager = deployProxy(_liquidityManagerDeploymentInfo);
        LiquidityManager(liquidityManager.proxy).initialize(_liquidityManagerParams);
    }

    function deployBuyProduct(
        ProxyDeploymentInfo calldata _buyProductDeploymentInfo,
        BuyProduct.InitializeParams memory _buyProductParams
    ) external onlyOwner {
        buyProduct = deployProxy(_buyProductDeploymentInfo);
        BuyProduct(buyProduct.proxy).initialize(_buyProductParams);
    }
}
