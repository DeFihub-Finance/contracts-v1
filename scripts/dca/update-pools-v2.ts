import { createArrayOfIndexes, ERC20PricedJson, ERC20JsonAddressMap, exchangesMeta } from '@defihub/shared'
import { DollarCostAverage__factory, Quoter__factory } from '@src/typechain'
import { API, findAddressOrFail, getChainId, getSigner, proposeTransactions } from '@src/helpers'
import { BatchLimiter, BigNumber, ChainId, ChainIds, ChainMap, notEmpty } from '@ryze-blockchain/ethereum'
import { PreparedTransactionRequest, Signer } from 'ethers'

type Pool = Awaited<ReturnType<typeof getPools>>[number]
type PoolWithSwapData = Pool & {
    inputAmount: bigint
    outputAmount: bigint
    slippage: BigNumber
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

let chainId: ChainId
let signer: Signer
let tokens: TokenMap

async function updatePools() {
    chainId = await getChainId()
    signer = await getSigner()

    const originalPools = await getPools()

    tokens = await getTokens(originalPools)

    const updates = await getPoolUpdates(originalPools)
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

    console.log(pools.length, [...tokenAddresses].length)

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
        inputAmount,
        originalOutputAmount,
        pool.inputToken,
        pool.outputToken,
    )

    if (originalSlippage.gte(MAX_SLIPPAGE))
        console.warn(`High slippage ${ getPoolName(pool) }: ${ originalSlippage.times(100).toFixed(2) }%`)

    // no need to update if pools are the same
    if (!newOutputAmount)
        return

    return {
        original: {
            ...pool,
            inputAmount,
            outputAmount: originalOutputAmount,
            slippage: originalSlippage,
        },
        updated: {
            ...pool,
            inputAmount,
            outputAmount: newOutputAmount,
            slippage: calculateSlippage(
                inputAmount,
                newOutputAmount,
                pool.inputToken,
                pool.outputToken,
            ),
        },
    }
}

async function getQuote(router: string, path: string, inputAmount: bigint) {
    const quoterAddress = routerToQuoter[chainId]?.[router]

    if (!quoterAddress)
        throw new Error(`Quoter not found ${ router }`)

    const quoter = Quoter__factory.connect(quoterAddress, signer)

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

function calculateSlippage(
    amountIn: bigint,
    amountOut: bigint,
    tokenIn: string,
    tokenOut: string,
) {
    const amountInUSD = tokenAmountToUSD(amountIn, tokenIn)
    const amountOutUSD = tokenAmountToUSD(amountOut, tokenOut)

    return new BigNumber(1).minus(amountOutUSD.div(amountInUSD))
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
