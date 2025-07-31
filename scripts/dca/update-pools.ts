import { createArrayOfIndexes, ERC20PricedJson, ERC20JsonAddressMap, exchangeDeploymentsByChain } from '@defihub/shared'
import { DollarCostAverage__factory, Quoter__factory } from '@src/typechain'
import { API, findAddressOrFail, getChainId, getSigner, proposeTransactions } from '@src/helpers'
import { BatchLimiter, BigNumber, ChainId, notEmpty } from '@ryze-blockchain/ethereum'
import { PreparedTransactionRequest, Signer } from 'ethers'
import { green, grey, red, yellow } from 'chalk'

type Pool = Awaited<ReturnType<typeof getPools>>[number]
type Update = {
    pid: bigint
    router: string
    path: string
}
type TokenMap = ERC20JsonAddressMap<ERC20PricedJson>

const limiter = new BatchLimiter(10, 1_000)
const INPUT_AMOUNT_USD = new BigNumber(1_000) // $1.000
const MAX_PRICE_IMPACT = 0.01 // 1%

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

        const { originalOutputAmount, updatedOutputAmount, updatedPool } = quotes
        const originalOutputUSD = tokenAmountToUSD(originalOutputAmount, pool.outputToken)
        const updatedOutputUSD = tokenAmountToUSD(updatedOutputAmount, pool.outputToken)

        // update only if $0.01 difference or higher
        if (originalOutputUSD.plus(0.01).gte(updatedOutputUSD))
            return

        const originalImpact = red(
            calculatePriceImpact(originalOutputUSD)
                .times(100)
                .toFixed(2) + '%',
        )
        const updatedImpact = green(
            calculatePriceImpact(updatedOutputUSD)
                .times(100)
                .toFixed(2) + '%',
        )

        updateLogs.push(
            `${ grey('Updating') } ${ getPoolName(pool) } ${ originalImpact } ${ grey('=>') } ${ updatedImpact }`,
        )

        return {
            pid: pool.pid,
            router: updatedPool.router,
            path: updatedPool.path,
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

async function getQuotes(pool: Pool): Promise<{
    originalOutputAmount: bigint
    updatedOutputAmount: bigint
    updatedPool: Pool
} | undefined> {
    const inputTokenData = tokens[pool.inputToken]

    if (!inputTokenData)
        throw new Error(`Token not found: ${ pool.inputToken }`)

    const inputAmount = BigInt(
        INPUT_AMOUNT_USD
            .div(inputTokenData.price)
            .shiftedBy(inputTokenData.decimals)
            .toFixed(0),
    )

    const updatedSwap = await API.getSwapPath(
        chainId,
        pool.inputToken,
        pool.outputToken,
        inputAmount,
    )

    if (!updatedSwap)
        throw new Error(`No path found for ${ pool.pid } (${ pool.inputToken } => ${ pool.outputToken })`)

    // TODO: API gives us `universalRouter`, but DCA still uses `swapRouter02`.
    // We map it using `exchangeDeploymentsByChain` for now.
    // Once DCA supports `universalRouter`, we can just use `updatedSwap.router` directly.
    const updatedRouter = exchangeDeploymentsByChain[chainId]
        ?.find(exchange => exchange.universalRouter === updatedSwap.router)
        ?.swapRouter02

    if (!updatedRouter)
        throw new Error(`Router not found for ${ updatedSwap.router }`)

    const updatedPath = updatedSwap.path.encodedPath().toLowerCase()

    const isSamePath = pool.router === updatedRouter && pool.path === updatedPath

    const [
        originalOutputAmount,
        updatedOutputAmount,
    ] = await Promise.all([
        getQuote(pool.router, pool.path, inputAmount),
        isSamePath ? null : getQuote(updatedRouter, updatedPath, inputAmount),
    ])

    const originalImpact = calculatePriceImpact(
        tokenAmountToUSD(
            originalOutputAmount,
            pool.outputToken,
        ),
    )

    if (originalImpact.gte(MAX_PRICE_IMPACT))
        console.warn(yellow(`High price impact ${ getPoolName(pool) }: ${ originalImpact.times(100).toFixed(2) }%`))

    // no need to update if pools are the same
    if (!updatedOutputAmount)
        return

    return {
        originalOutputAmount,
        updatedOutputAmount,
        updatedPool: {
            ...pool,
            router: updatedRouter,
            path: updatedPath,
        },
    }
}

function routerToQuoter(router: string) {
    // TODO this also needs to be updated once DCA supports `universalRouter`
    const quoter = exchangeDeploymentsByChain[chainId]
        ?.find(exchange => exchange.swapRouter02 === router)
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

function calculatePriceImpact(amountOutUSD: BigNumber) {
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
