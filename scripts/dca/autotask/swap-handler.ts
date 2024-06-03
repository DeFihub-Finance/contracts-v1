import { Defender } from '@openzeppelin/defender-sdk'
import { AddressLike } from 'ethers'
import { Chain, ChainId, ChainIds, ChainMap, notEmpty } from '@ryze-blockchain/ethereum'
import { ERC20, ERC20__factory, getAddressOrFail, unwrapAddressLike } from '@defihub/shared'
import { BigNumber } from '@ryze-blockchain/ethereum'
import { DollarCostAverage, DollarCostAverage__factory, Quoter__factory } from '@src/typechain'
import { getTokenPrices } from '@src/helpers/get-token-price'
import { Quoter } from '@src/typechain'

interface Pool {
    info: DollarCostAverage.PoolInfoStruct,
    id: number,
}

const quoterAddresses: ChainMap<string> = {
    [ChainIds.ARBITRUM]: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
}

export class SwapHandler {
    private static readonly SWAP_VOLUME_THRESHOLD = new BigNumber('0.1') // in USD
    private static readonly QUOTER_SLIPPAGE = new BigNumber('0.01') // 1%
    private static readonly SPOT_SLIPPAGE = new BigNumber('0.03') // 3%
    private readonly provider: ReturnType<Defender['relaySigner']['getProvider']>

    constructor(
        private readonly chainId: ChainId,
        private readonly defender: Defender,
    ) {
        this.provider = defender.relaySigner.getProvider()
    }

    public async swap() {
        const pools = await this.fetchPools()
        const poolsToExecuteSwap = await this.getPoolsToExecuteSwap(pools)

        if (poolsToExecuteSwap.length > 0) {
            console.log('Running swap for pools', poolsToExecuteSwap.map(pool => pool.id).join(', '))

            const tx = await this.sendTx(poolsToExecuteSwap)

            console.log('Transaction sent ', tx.hash)
        }
        else {
            console.log('No pools to execute swap at this time')
        }
    }

    private async getPoolsToExecuteSwap(pools: Pool[]): Promise<Pool[]> {
        const timestamp = (await this.provider.getBlock('latest'))?.timestamp

        if (!timestamp)
            throw new Error('Could not fetch latest block timestamp')

        return (await Promise.all(pools.map(async pool => {
            const inputVolumeNextSwap = await this.getInputVolumeNextSwap(pool)
            const tooEarlyToSwap = BigInt(timestamp) < BigInt(pool.info.lastSwapTimestamp) + BigInt(pool.info.interval)

            if (tooEarlyToSwap)
                return undefined

            // Cannot be ran before the `if` above, since the gas estimation will fail
            // when there's no tokens to swap
            if (inputVolumeNextSwap.gte(SwapHandler.SWAP_VOLUME_THRESHOLD))
                return pool
        }))).filter(notEmpty)
    }

    private async fetchPools(): Promise<Pool[]> {
        const poolLength = await this.dca.getPoolsLength()
        const poolPromises: Promise<DollarCostAverage.PoolInfoStruct>[] = []

        for (let i = 0; i < poolLength; i++)
            poolPromises.push(this.dca.getPool(i))

        return (await Promise.all(poolPromises)).map((info, id) => ({ info, id }))
    }

    private async getInputVolumeNextSwap(pool: Pool): Promise<BigNumber> {
        const amount = pool.info.nextSwapAmount

        const [price, decimals] = await Promise.all([
            this.getTokenPrice(pool.info.inputToken),
            (await this.getTokenContract(pool.info.inputToken)).decimals(),
        ])

        return new BigNumber(amount.toString())
            .shiftedBy(-Number(decimals))
            .times(price)
    }

    private async getTokenPrice(addressLike: AddressLike): Promise<BigNumber> {
        const address = (await unwrapAddressLike(addressLike)).toLowerCase()

        const { [address]: price } = await getTokenPrices([
            {
                chainId: this.chainId,
                address,
            },
        ])

        if (!price)
            throw new Error(`Price not found for token ${ address }`)

        return price
    }

    private async sendTx(pools: Pool[]) {
        const txParams = await Promise.all(pools.map(async pool => ({
            poolId: pool.id,
            minOutputAmount: await this.getMinOutputAmount(pool),
        })))
        const populatedTransaction = await this.dca.swap.populateTransaction(txParams)
        const txData = {
            to: await unwrapAddressLike(this.dca.getAddress()),
            data: populatedTransaction.data,
        }

        return this.defender.relaySigner.sendTransaction({
            ...txData,
            gasLimit: (await this.getGasLimit(txData)).toString(),
        })
    }

    private async getGasLimit(txData: { to: string, data: string }): Promise<BigNumber> {
        return new BigNumber(
            (await this.provider.estimateGas({
                ...txData,
                from: (await this.defender.relaySigner.getRelayer()).address,
            })).toString(),
        ).times(2)
    }

    /**
     * This functions calculates the minimum output amount based on spot price and Quoter price
     * The swap only happens when the quoter price is better or equal to the spot price. This
     * avoids swaps that would happen when a pool is at difference equilibrium than the market rate.
     */
    private async getMinOutputAmount(pool: Pool): Promise<bigint> {
        const [
            spotExpectedOutput,
            quoterExpectedOutput,
            inputTokenSymbol,
            outputTokenSymbol,
        ] = await Promise.all([
            this.getExpectedSpotOutput(pool),
            this.getExpectedQuoterOutput(pool),
            (await this.getTokenContract(pool.info.inputToken)).symbol(),
            (await this.getTokenContract(pool.info.outputToken)).symbol(),
        ])
        const tolerableMinOutput = this.subtractPercentage(
            spotExpectedOutput,
            SwapHandler.SPOT_SLIPPAGE,
        )
        const minOutput = this.subtractPercentage(
            quoterExpectedOutput,
            SwapHandler.QUOTER_SLIPPAGE,
        )

        if (tolerableMinOutput > minOutput) {
            throw new Error(`
                [${ inputTokenSymbol } => ${ outputTokenSymbol }] Quoter exchange rate is 3% below market price \n
                Spot: min ${ tolerableMinOutput } | expected ${ spotExpectedOutput }  \n
                Quoter: min ${ minOutput } | expected ${ quoterExpectedOutput }
            `)
        }

        console.log(
            `[${ inputTokenSymbol } => ${ outputTokenSymbol }]`,
            `Spot: min ${ tolerableMinOutput } | expected ${ spotExpectedOutput }`,
            `Quoter: min ${ minOutput } | expected ${ quoterExpectedOutput }`,
        )

        return minOutput
    }

    private async getExpectedQuoterOutput(pool: Pool): Promise<bigint> {
        return this.quoter.quoteExactInput.staticCall(
            pool.info.path,
            pool.info.nextSwapAmount,
        )
    }

    private async getExpectedSpotOutput(pool: Pool): Promise<bigint> {
        const [
            inputTokenPrice,
            outputTokenPrice,
            inputTokenDecimals,
            outputTokenDecimals,
        ] = await Promise.all([
            this.getTokenPrice(pool.info.inputToken),
            this.getTokenPrice(pool.info.outputToken),
            (await this.getTokenContract(pool.info.inputToken)).decimals(),
            (await this.getTokenContract(pool.info.outputToken)).decimals(),
        ])
        const exchangeRate = inputTokenPrice.div(outputTokenPrice)
        const nextSwapAmount = new BigNumber(pool.info.nextSwapAmount.toString())
            .shiftedBy(-Number(inputTokenDecimals))

        return BigInt(
            nextSwapAmount.times(exchangeRate)
                .shiftedBy(Number(outputTokenDecimals))
                .toFixed(0),
        )
    }

    private subtractPercentage(amount: bigint, percentage: BigNumber): bigint {
        const amountBN = new BigNumber(amount.toString())

        return BigInt(
            amountBN
                .minus(amountBN.times(percentage))
                .toFixed(0),
        )
    }

    private get dca(): DollarCostAverage {
        return DollarCostAverage__factory.connect(
            getAddressOrFail(this.chainId, 'DollarCostAverage'),
            this.provider,
        )
    }

    private get quoter(): Quoter {
        const quoterAddress = quoterAddresses[this.chainId]

        if (!quoterAddress)
            throw new Error(`Quoter address not found for chain ${ this.chainId }`)

        return Quoter__factory.connect(quoterAddress, this.provider)
    }

    private async getTokenContract(address: AddressLike): Promise<ERC20> {
        return ERC20__factory.connect(
            await unwrapAddressLike(address),
            this.provider,
        )
    }
}

/**
 * The event type isn't being exported from the Defender SDK, so we have to use
 * this workaround to define its type
 */
export async function handler(event: ConstructorParameters<typeof Defender>[0]) {
    const defender = new Defender(event)
    const chainId = Chain.parseChainIdOrFail((await defender.relaySigner.getProvider().getNetwork()).chainId)

    await new SwapHandler(chainId, defender).swap()
}
