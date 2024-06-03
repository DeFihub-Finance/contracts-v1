import {
    ERC20PricedJson,
    PathUniswapV3,
    reduceTokensByAddress,
    unwrapAddressLike,
} from '@defihub/shared'
import { ofetch } from 'ofetch'
import { BigNumber, Chain } from '@ryze-blockchain/ethereum'
import { ERC20__factory, UniswapV3Factory__factory } from '@src/typechain'
import hre from 'hardhat'
import { currencyFormatter, findAddressOrFail, shortCurrencyFormatter } from '@src/helpers'

async function getAllTokens(pools: PathUniswapV3[]) {
    const allTokens = new Set<string>()

    for (const pool of pools) {
        allTokens.add((await unwrapAddressLike(pool.inputToken)))

        for (const hop of pool.hops)
            allTokens.add((await unwrapAddressLike(hop.token)))
    }

    return [...allTokens]
}

async function getTokens(pools: PathUniswapV3[]) {
    const tokenAddresses = await getAllTokens(pools)
    const chainId = Chain.parseChainIdOrFail((await hre.ethers.provider.getNetwork()).chainId)

    const tokens = await ofetch<ERC20PricedJson[]>(process.env.DEFIHUB_API + '/tokens/get', {
        method: 'POST',
        body: {
            tokens: tokenAddresses.map(address => ({ chainId, address })),
        },
    })

    return reduceTokensByAddress(tokens)
}

async function logPoolIssue(
    pool: PathUniswapV3,
    poolLiquidity: BigNumber,
    symbolPreviousHopToken: string,
    symbolCurrentHopToken: string,
    minLiquidityUSD: number,
) {
    const [deployer] = await hre.ethers.getSigners()
    const [inputTokenSymbol, outputTokenSymbol] = await Promise.all([
        ERC20__factory.connect(await unwrapAddressLike(pool.inputToken), deployer).symbol(),
        ERC20__factory.connect(await unwrapAddressLike(pool.outputToken), deployer).symbol(),
    ])

    throw new Error([
        `Cancelling ${ inputTokenSymbol } => ${ outputTokenSymbol } pool`,
        `Insufficient liquidity in ${ symbolPreviousHopToken } => ${ symbolCurrentHopToken } Uniswap pool`,
        `Available Liquidity: $${ currencyFormatter.format(poolLiquidity.toNumber()) }`,
        `Min liquidity required: $${ currencyFormatter.format(minLiquidityUSD) }`,
    ].join('\n'))
}

export async function validateDcaPools(pools: PathUniswapV3[], minLiquidityUSD: number) {
    const [deployer] = await hre.ethers.getSigners()
    const tokensByAddress = await getTokens(pools)
    const factory = UniswapV3Factory__factory.connect(
        await findAddressOrFail('UniswapFactoryV3'),
        deployer,
    )

    for (const pool of pools) {
        let previousHopTokenAddress = pool.inputToken

        console.log(
            '------- validating',
            tokensByAddress[await unwrapAddressLike(pool.inputToken)]?.symbol,
            '=>',
            tokensByAddress[await unwrapAddressLike(pool.outputToken)]?.symbol,
            'dca pool -------',
        )

        for (const hop of pool.hops) {
            const poolAddr = await factory.getPool(previousHopTokenAddress, hop.token, hop.fee)

            const [balancePreviousHopTokenBI, balanceCurrentHopTokenBI] = await Promise.all([
                ERC20__factory
                    .connect(await unwrapAddressLike(previousHopTokenAddress), deployer)
                    .balanceOf(poolAddr),
                ERC20__factory
                    .connect(await unwrapAddressLike(hop.token), deployer)
                    .balanceOf(poolAddr),
            ])

            const previousHopTokenMeta = tokensByAddress[await unwrapAddressLike(previousHopTokenAddress)]
            const currentHopTokenMeta = tokensByAddress[await unwrapAddressLike(hop.token)]

            if (!previousHopTokenMeta)
                throw new Error(`Token not found: ${ await unwrapAddressLike(previousHopTokenAddress) }`)

            if (!currentHopTokenMeta)
                throw new Error(`Token not found for ${ await unwrapAddressLike(hop.token) }`)

            const balancePreviousHopToken = new BigNumber(balancePreviousHopTokenBI.toString())
                .shiftedBy(-previousHopTokenMeta.decimals.toString())
            const valuePreviousHopToken = balancePreviousHopToken
                .times(previousHopTokenMeta.price)

            const balanceCurrentHopToken = new BigNumber(balanceCurrentHopTokenBI.toString())
                .shiftedBy(-currentHopTokenMeta.decimals.toString())
            const valueCurrentHopToken = balanceCurrentHopToken
                .times(currentHopTokenMeta.price)

            if (valuePreviousHopToken.lt(minLiquidityUSD) || valueCurrentHopToken.lt(minLiquidityUSD)) {
                await logPoolIssue(
                    pool,
                    valuePreviousHopToken.lt(minLiquidityUSD)
                        ? valuePreviousHopToken
                        : valueCurrentHopToken,
                    previousHopTokenMeta.symbol,
                    currentHopTokenMeta.symbol,
                    minLiquidityUSD,
                )
            }

            console.log(`${ previousHopTokenMeta.symbol } => ${ currentHopTokenMeta.symbol }`)
            console.log(
                shortCurrencyFormatter.format(valuePreviousHopToken.toNumber()),
                '|',
                shortCurrencyFormatter.format(valueCurrentHopToken.toNumber()),
            )

            previousHopTokenAddress = await unwrapAddressLike(hop.token)
        }
    }
}
