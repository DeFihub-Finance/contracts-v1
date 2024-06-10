import { ZapperFunctionSignature, ZapProtocol } from '@src/helpers'
import {
    ICall__factory,
    StrategyManager,
    SubscriptionManager,
    ZapManager,
    ZapManager__factory,
} from '@src/typechain'
import { AbiCoder, AddressLike, ErrorDescription, Signer } from 'ethers'
import { SubscriptionSigner, unwrapAddressLike } from '@defihub/shared'
import { NetworkService } from '@src/NetworkService'
import { toUtf8String } from 'ethers'

export class BaseZapHelper {
    public constructor(
        public readonly zapManager: ZapManager,
        public readonly strategyManager: StrategyManager,
        public readonly subscriptionManager: SubscriptionManager,
        public readonly subscriptionSigner: Signer,
    ) {
    }

    protected async getInvestmentAmountWithoutFee(
        strategyId: bigint,
        product: AddressLike,
        amount: bigint,
        investor: AddressLike,
    ) {
        const chainId = await NetworkService.getChainId()
        const deadline = await NetworkService.getDeadline()
        const subscriptionSigner = await this.getSubscriptionSigner()
        const strategist = await this.strategyManager.getStrategyCreator(strategyId)

        const investorPermit = await subscriptionSigner
            .signSubscriptionPermit(investor, deadline, chainId)
        const strategistPermit = await subscriptionSigner
            .signSubscriptionPermit(strategist, deadline, chainId)

        const { strategistFee, protocolFee } = await this.strategyManager.calculateFee(
            strategyId,
            product,
            amount,
            investor,
            strategist,
            investorPermit,
            strategistPermit,
        )

        return amount - (strategistFee + protocolFee)
    }

    protected async getSubscriptionSigner() {
        return new SubscriptionSigner(
            this.subscriptionManager,
            this.subscriptionSigner,
        )
    }

    protected static async encodeSwap(inputToken: AddressLike, amount: bigint, swapBytes: string) {
        return new AbiCoder().encode(
            ['tuple(address,uint,bytes)'],
            [
                [
                    await unwrapAddressLike(inputToken),
                    amount,
                    swapBytes,
                ],
            ],
        )
    }

    protected static async callProtocol(
        protocol: ZapProtocol,
        inputToken: AddressLike,
        outputToken: AddressLike,
        zapperFunctionSignature: ZapperFunctionSignature,
        data: string,
    ) {
        return ZapManager__factory.createInterface().encodeFunctionData(
            'callProtocol',
            [
                {
                    protocolName: protocol,
                    inputToken: await unwrapAddressLike(inputToken),
                    outputToken: await unwrapAddressLike(outputToken),
                    zapperFunctionSignature,
                    data: data,
                },
            ],
        )
    }
}
