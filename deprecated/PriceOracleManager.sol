// SPDX-License-Identifier: MIT

pragma solidity 0.8.22;

import {HubOwnable} from "./abstract/HubOwnable.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract PriceOracleManager is HubOwnable {
    enum Order {
        TO_USD,
        FROM_USD
    }

    struct PriceOracle {
        AggregatorV3Interface addr;
        uint8 decimals;
        Order order;
    }

    mapping(address => PriceOracle) public priceOracles;

    event PriceOracleUpdated(
        address token,
        AggregatorV3Interface priceFeed,
        uint8 decimals,
        Order order
    );

    function setPriceOracle(
        address _token,
        AggregatorV3Interface _priceOracle,
        Order _order
    ) external onlyOwner {
        uint8 decimals = _priceOracle.decimals();

        priceOracles[_token] = PriceOracle({
            addr: _priceOracle,
            decimals: decimals,
            order: _order
        });

        emit PriceOracleUpdated(_token, _priceOracle, decimals, _order);
    }

    function getPrice(
        address _token
    ) external view returns (
        uint price,
        uint8 decimals
    ) {
        PriceOracle memory oracle = priceOracles[_token];

        (, int256 _price, , ,) = oracle.addr.latestRoundData();

        uint multiplier = 10 ** oracle.decimals;
        uint unsignedPrice = uint(_price < 0 ? - _price : _price);

        uint usdPrice = oracle.order == Order.FROM_USD
            ? unsignedPrice * multiplier * multiplier / decimals
            : unsignedPrice;

        return (usdPrice, oracle.decimals);
    }
}
