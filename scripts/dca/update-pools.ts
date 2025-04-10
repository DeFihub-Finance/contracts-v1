import { createArrayOfIndexes, ERC20PricedJson, ERC20JsonAddressMap, exchangesMeta } from '@defihub/shared'
import { DollarCostAverage__factory, Quoter__factory } from '@src/typechain'
import { API, findAddressOrFail, getChainId, getSigner, proposeTransactions } from '@src/helpers'
import { BatchLimiter, BigNumber, ChainId, notEmpty } from '@ryze-blockchain/ethereum'
import { PreparedTransactionRequest, Signer } from 'ethers'
import { green, grey, red, yellow } from 'chalk'

type Pool = Awaited<ReturnType<typeof getPools>>[number]
type PoolWithSwapData = Pool & {
    inputAmount: bigint
    outputAmount: bigint
}
type Update = {
    pid: bigint
    router: string
    path: string
}
type TokenMap = ERC20JsonAddressMap<ERC20PricedJson>

const limiter = new BatchLimiter(10, 1_000)
const INPUT_AMOUNT_USD = new BigNumber(1_000) // $1.000
const MAX_SLIPPAGE = 0.01 // 1%

let chainId: ChainId
let signer: Signer
let tokens: TokenMap
const updateLogs: string[] = []

async function updatePools() {
    chainId = await getChainId()
    signer = await getSigner()

    const originalPools = await getPools()

    tokens = await getTokens(originalPools)

    const updates = await getPoolUpdates(originalPools)

    for (const log of updateLogs)
        console.info(log)

    const dcaContract = await getDcaContract()

    const transactions: PreparedTransactionRequest[] = await Promise.all(
        updates.map(pool => dcaContract.setPoolRouterAndPath.populateTransaction(
            pool.pid,
            pool.router,
            pool.path,
        )),
    )

    await proposeTransactions(chainId, transactions)
}

async function getPools() {
    const dcaContract = await getDcaContract()
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

async function getPoolUpdates(pools: Pool[]): Promise<Update[]> {
    const updates = await Promise.all(pools.map(async pool => {
        const quotes = await getQuotes(pool)

        // new pool had no changes
        if (!quotes)
            return

        const { original, updated } = quotes
        const originalOutputUSD = tokenAmountToUSD(original.outputAmount, pool.outputToken)
        const updatedOutputUSD = tokenAmountToUSD(updated.outputAmount, pool.outputToken)

        // update only if $0.01 difference or higher
        if (originalOutputUSD.plus(0.01).gte(updatedOutputUSD))
            return

        const originalSlippage = red(
            calculateSlippage(originalOutputUSD)
                .times(100)
                .toFixed(2) + '%',
        )
        const updatedSlippage = green(
            calculateSlippage(updatedOutputUSD)
                .times(100)
                .toFixed(2) + '%',
        )

        updateLogs.push(
            `${ grey('Updating') } ${ getPoolName(pool) } ${ originalSlippage } ${ grey('=>') } ${ updatedSlippage }`,
        )

        return {
            pid: pool.pid,
            router: updated.router,
            path: updated.path,
        }
    }))

    return updates.filter(notEmpty)
}

async function getTokens(pools: Pool[]) {
    const tokenAddresses = new Set(
        pools
            .map(({ inputToken, outputToken }) => [inputToken, outputToken])
            .flat(),
    )

    return API.getTokens([...tokenAddresses].map(address => ({ chainId, address })))
}

async function getQuotes(pool: Pool): Promise<{ original: PoolWithSwapData, updated: PoolWithSwapData } | undefined> {
    const inputTokenData = tokens[pool.inputToken]

    if (!inputTokenData)
        throw new Error(`Token not found: ${ pool.inputToken }`)

    const inputAmount = BigInt(
        INPUT_AMOUNT_USD
            .div(inputTokenData.price)
            .shiftedBy(inputTokenData.decimals)
            .toFixed(0),
    )

    const newSwap = await API.getSwapPath(
        chainId,
        pool.inputToken,
        pool.outputToken,
        inputAmount,
    )

    if (!newSwap)
        throw new Error(`No path found for ${ pool.pid } (${ pool.inputToken } => ${ pool.outputToken })`)

    const newRouter = exchangesMeta[chainId]
        ?.find(exchange => exchange.protocol === newSwap.protocol)
        ?.router

    if (!newRouter)
        throw new Error(`Router not found for ${ newSwap.protocol }`)

    const newPath = (await newSwap.path.encodedPath()).toLowerCase()

    const isSamePath = pool.router === newRouter && pool.path === newPath

    const [
        originalOutputAmount,
        newOutputAmount,
    ] = await Promise.all([
        getQuote(pool.router, pool.path, inputAmount),
        isSamePath ? null : getQuote(newRouter, newPath, inputAmount),
    ])

    const originalSlippage = calculateSlippage(
        tokenAmountToUSD(
            originalOutputAmount,
            pool.outputToken,
        ),
    )

    if (originalSlippage.gte(MAX_SLIPPAGE))
        console.warn(yellow(`High slippage ${ getPoolName(pool) }: ${ originalSlippage.times(100).toFixed(2) }%`))

    // no need to update if pools are the same
    if (!newOutputAmount)
        return

    return {
        original: {
            ...pool,
            inputAmount,
            outputAmount: originalOutputAmount,
        },
        updated: {
            ...pool,
            inputAmount,
            outputAmount: newOutputAmount,
        },
    }
}

function routerToQuoter(router: string) {
    const quoter = exchangesMeta[chainId]
        ?.find(exchange => exchange.router === router)
        ?.quoter

    if (!quoter)
        throw new Error(`Quoter not found for router ${ router }`)

    return quoter
}

async function getQuote(router: string, path: string, inputAmount: bigint) {
    const quoter = Quoter__factory.connect(routerToQuoter(router), signer)

    try {
        await limiter.consumeLimit()
        const [amountOut] = await quoter.quoteExactInput.staticCallResult(
            path,
            inputAmount,
        )

        return amountOut
    }
    catch (e) {
        const error = e as Error
        const knownMessages = [
            'execution reverted: SPL',
            'execution reverted: Unexpected error',
        ]

        if (knownMessages.includes(error.message))
            return 0n

        throw error
    }
}

function tokenAmountToUSD(amount: bigint, address: string) {
    const tokenData = tokens[address]

    // should be unreachable
    if (!tokenData)
        throw new Error(`Token not found: ${ address }`)

    return new BigNumber(amount.toString())
        .times(tokenData.price)
        .shiftedBy(-tokenData.decimals)
}

function calculateSlippage(amountOutUSD: BigNumber) {
    return new BigNumber(1).minus(amountOutUSD.div(INPUT_AMOUNT_USD))
}

function getPoolName(pool: Pool) {
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
        signer,
    )
}

updatePools()
