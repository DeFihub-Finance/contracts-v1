import { createArrayOfIndexes, ERC20PricedJson, ERC20JsonAddressMap, exchangesMeta } from '@defihub/shared'
import { DollarCostAverage__factory, Quoter__factory } from '@src/typechain'
import { API, findAddressOrFail, getChainId, getSigner, proposeTransactions } from '@src/helpers'
import { BatchLimiter, BigNumber, ChainIds, ChainMap } from '@ryze-blockchain/ethereum'
import { PreparedTransactionRequest } from 'ethers'

type Pool = Awaited<ReturnType<typeof getPools>>[number]
type PoolWithSlippage = Pool & { inputAmount: bigint, slippage: BigNumber }
type TokenMap = ERC20JsonAddressMap<ERC20PricedJson>

const limiter = new BatchLimiter(5, 1_000)
const MAX_SLIPPAGE = 0.01 // 1%

const routerToQuoter: ChainMap<Record<string, string>> = {
    [ChainIds.ARBITRUM]: {
        '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6', // uni router02
        '0xa51afafe0263b40edaef0df8781ea9aa03e381a3': '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6', // uni universal

        '0x1b81d678ffb9c0263b24a97847620c99d213eb14': '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997', // pancake router02
        '0x13f4ea83d0bd40e75c8222255bc855a974568dd4': '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997', // pancake universal
    },
    [ChainIds.BNB]: {
        '0xb971ef87ede563556b2ed4b1c0b0019111dd85d2': '0x78d78e420da98ad378d7799be8f4af69033eb077', // uni router02
        '0x1906c1d672b88cd1b9ac7593301ca990f94eae07': '0x78d78e420da98ad378d7799be8f4af69033eb077', // uni universal

        '0x13f4ea83d0bd40e75c8222255bc855a974568dd4': '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997', // pancake smart
        '0x1b81d678ffb9c0263b24a97847620c99d213eb14': '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997', // pancake router02
        '0x32226588378236fd0c7c4053999f88ac0e5cac77': '0xb048bbc1ee6b733fffcfb9e9cef7375518e25997', // pancake universal
    },
}

async function updatePools() {
    const chainId = await getChainId()
    const currentPools = await getPools()
    const tokens = await getTokens(currentPools)
    const poolsWithSlippage = await addSlippageToPools(currentPools, tokens)
    const poolsWithHighSlippage = poolsWithSlippage.filter(pool => pool.slippage.gte(MAX_SLIPPAGE))

    console.log(
        'High slippage pools',
        poolsWithHighSlippage.length,
        poolsWithHighSlippage.map(pool => getPoolName(pool, tokens)),
    )

    const poolsWithUpdatedPaths = await getPoolsWithUpdatedPaths(poolsWithHighSlippage, tokens)
    const dcaContract = await getDcaContract()

    const transactions: PreparedTransactionRequest[] = await Promise.all(
        poolsWithUpdatedPaths
            .filter(pool => pool.slippage.lt(MAX_SLIPPAGE))
            .map(pool => dcaContract.setPoolRouterAndPath.populateTransaction(
                pool.pid,
                pool.router,
                pool.path,
            )),
    )

    await proposeTransactions(chainId, transactions)
}

async function getPools() {
    const signer = await getSigner()
    const dcaContract = DollarCostAverage__factory.connect(await findAddressOrFail('DollarCostAverage'), signer)
    const allPoolIds = createArrayOfIndexes(await dcaContract.getPoolsLength())

    return Promise.all(allPoolIds.map(async pid => {
        await limiter.consumeLimit()
        const {
            inputToken,
            outputToken,
            router,
            path,
        } = await dcaContract.getPool(pid)

        return {
            pid,
            inputToken: inputToken.toLowerCase(),
            outputToken: outputToken.toLowerCase(),
            router: router.toLowerCase(),
            path: path.toLowerCase(),
        }
    }))
}

async function addSlippageToPools(
    pools: Pool[],
    tokens: TokenMap,
): Promise<PoolWithSlippage[]> {
    const inputAmountUSD = new BigNumber(1000)

    return Promise.all(pools.map(async pool => {
        const inputTokenData = tokens[pool.inputToken]

        if (!inputTokenData)
            throw new Error(`Token not found: ${ pool.inputToken }`)

        const inputAmount = BigInt(
            inputAmountUSD
                .div(inputTokenData.price)
                .shiftedBy(inputTokenData.decimals)
                .toFixed(0),
        )

        try {
            await limiter.consumeLimit()
            const amountOut = await getQuote(pool.router, pool.path, inputAmount)

            return {
                ...pool,
                inputAmount,
                slippage: calculateSlippage(
                    inputAmount,
                    amountOut,
                    pool.inputToken,
                    pool.outputToken,
                    tokens,
                ),
            }
        }
        catch (e) {
            const error = e as Error
            const knownMessages = [
                'execution reverted: SPL',
                'execution reverted: Unexpected error',
            ]

            if (knownMessages.includes(error.message)) {
                return {
                    ...pool,
                    inputAmount,
                    slippage: BigNumber(1),
                }
            }

            throw error
        }
    }))
}

async function getPoolsWithUpdatedPaths(pools: PoolWithSlippage[], tokens: TokenMap) {
    const chainId = await getChainId()

    return Promise.all(pools.map(async pool => {
        const newSwap = await API.getSwapPath(
            chainId,
            pool.inputToken,
            pool.outputToken,
            pool.inputAmount,
        )

        if (!newSwap)
            throw new Error(`No path found for ${ pool.pid } (${ pool.inputToken } => ${ pool.outputToken })`)

        const newRouter = exchangesMeta[chainId]
            ?.find(exchange => exchange.protocol === newSwap.protocol)
            ?.router

        if (!newRouter)
            throw new Error(`Router not found for ${ newSwap.protocol }`)

        const amountOut = await getQuote(newRouter, await newSwap.path.encodedPath(), pool.inputAmount)
        const slippage = calculateSlippage(
            pool.inputAmount,
            amountOut,
            pool.inputToken,
            pool.outputToken,
            tokens,
        )

        return {
            ...pool,
            slippage,
            router: newRouter,
            path: await newSwap.path.encodedPath(),
        }

        // console.log({
        //     pool: getPoolName(pool, tokens),
        //     newSlippage: slippage.toFixed(8),
        //     oldSlippage: pool.slippage.toFixed(8),
        // })
    }))
}

async function getTokens(pools: Pool[]) {
    const chainId = await getChainId()
    const tokenAddresses = new Set(
        pools
            .map(({ inputToken, outputToken }) => [inputToken, outputToken])
            .flat(),
    )

    console.log(pools.length, [...tokenAddresses].length)

    return API.getTokens([...tokenAddresses].map(address => ({ chainId, address })))
}

async function getQuote(router: string, path: string, inputAmount: bigint) {
    const [
        chainId,
        signer,
    ] = await Promise.all([
        getChainId(),
        getSigner(),
    ])
    const quoterAddress = routerToQuoter[chainId]?.[router]

    if (!quoterAddress)
        throw new Error(`Quoter not found ${ router }`)

    const quoter = Quoter__factory.connect(quoterAddress, signer)
    const [amountOut] = await quoter.quoteExactInput.staticCallResult(
        path,
        inputAmount,
    )

    return amountOut
}

function calculateSlippage(
    amountIn: bigint,
    amountOut: bigint,
    tokenIn: string,
    tokenOut: string,
    tokenMap: TokenMap,
) {
    const inputTokenData = tokenMap[tokenIn]
    const outputTokenData = tokenMap[tokenOut]

    if (!inputTokenData)
        throw new Error(`Token not found: ${ tokenIn }`)

    if (!outputTokenData)
        throw new Error(`Token not found: ${ tokenOut }`)

    const amountInUSD = new BigNumber(amountIn.toString())
        .times(inputTokenData.price)
        .shiftedBy(-inputTokenData.decimals)
    const amountOutUSD = new BigNumber(amountOut.toString())
        .times(outputTokenData.price)
        .shiftedBy(-outputTokenData.decimals)

    return new BigNumber(1).minus(amountOutUSD.div(amountInUSD))
}

function getPoolName(pool: Pool, tokens: TokenMap) {
    const inputToken = tokens[pool.inputToken]
    const outputToken = tokens[pool.outputToken]

    // unreachable, just to remove undefined
    if (!inputToken || !outputToken)
        throw new Error(`Token not found: ${ pool.inputToken } or ${ pool.outputToken }`)

    return `${ inputToken.name } => ${ outputToken.name } [${ pool.pid }]`
}

async function getDcaContract() {
    return DollarCostAverage__factory.connect(
        await findAddressOrFail('DollarCostAverage'),
        await getSigner(),
    )
}

updatePools()
