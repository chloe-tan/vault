import Big from 'big.js'
import type { FastifyInstance } from 'fastify'
import { Address } from 'viem'

import {
  FUNKIT_API_BASE_URL,
  FUNKIT_STARKNET_CHAIN_ID,
  FUNKIT_STRIPE_SOURCE_CURRENCY,
  POLYGON_CHAIN_ID,
  POLYGON_NETWORK_NAME,
  TOKEN_INFO,
} from '@/constants/funkit'
import { pickSourceAssetForCheckout, roundUpToFiveDecimalPlaces } from '@/utils/funkit'

import { addressRegex } from '.'

interface CheckoutQuote {
  quoteId: string
  estTotalFromAmountBaseUnit: string
  estSubtotalFromAmountBaseUnit: string
  estFeesFromAmountBaseUnit: string
  fromTokenAddress: Address
  estFeesUsd: number
  estSubtotalUsd: number
  estTotalUsd: number
  estCheckoutTimeMs: number
}

export function getFunkitStripeCheckoutQuote(fastify: FastifyInstance, funkitApiKey: string) {
  fastify.get(
    '/get_funkit_stripe_checkout_quote',

    async (request, reply) => {
      const { address, tokenAmount, isNy } = request.query as { address: string; tokenAmount: number; isNy: boolean }

      if (!address) {
        return reply.status(400).send({ message: 'Address is required.' })
      }

      if (!addressRegex.test(address)) {
        return reply.status(400).send({ message: 'Invalid address format.' })
      }

      if (!tokenAmount) {
        return reply.status(400).send({ message: 'Token amount is required.' })
      }

      if (isNy == null) {
        return reply.status(400).send({ message: 'isNy is a required boolean.' })
      }

      try {
        // 1 - Generate the funkit checkout quote
        const toMultiplier = 10 ** TOKEN_INFO.STARKNET_USDC.decimals
        const toAmountBaseUnitBI = BigInt(Math.floor(tokenAmount * toMultiplier))
        const pickedSourceAsset = pickSourceAssetForCheckout(isNy)
        const queryParams = {
          fromChainId: POLYGON_CHAIN_ID,
          fromTokenAddress: pickedSourceAsset.address,
          toChainId: FUNKIT_STARKNET_CHAIN_ID,
          toTokenAddress: TOKEN_INFO.STARKNET_USDC.address,
          toAmountBaseUnit: toAmountBaseUnitBI.toString(),
          recipientAddr: address,
          // 1 hour from now
          checkoutExpirationTimestampSeconds: Math.round((Date.now() + 3600000) / 1000).toString(),
        }
        const searchParams = new URLSearchParams(queryParams)
        const fetchRes = await fetch(`${FUNKIT_API_BASE_URL}/checkout/quote?${searchParams}`, {
          headers: {
            'X-Api-Key': funkitApiKey,
          },
        })
        const quoteRes = (await fetchRes.json()) as CheckoutQuote
        if (!quoteRes || !quoteRes.quoteId) {
          return reply.status(500).send({ message: 'Failed to get a funkit quote.' })
        }

        const fromMultiplier = 10 ** pickedSourceAsset.decimals
        const estTotalFromAmount = roundUpToFiveDecimalPlaces(
          new Big(quoteRes.estTotalFromAmountBaseUnit).div(fromMultiplier).toString(),
        ).toString()

        // 2 - Get the stripe quote based on the
        const stripeQuoteParams = {
          sourceCurrency: FUNKIT_STRIPE_SOURCE_CURRENCY,
          destinationCurrencies: pickedSourceAsset.symbol,
          destinationNetworks: POLYGON_NETWORK_NAME,
          destinationAmount: estTotalFromAmount,
        }
        const stripeQuoteSearchParams = new URLSearchParams(stripeQuoteParams)
        const stripeQuoteRes = await fetch(
          `${FUNKIT_API_BASE_URL}/on-ramp/stripe-buy-quote?${stripeQuoteSearchParams}`,
          {
            headers: {
              'X-Api-Key': funkitApiKey,
            },
          },
        )
        const stripeQuote = (await stripeQuoteRes.json()) as any
        const stripePolygonQuote = stripeQuote?.destination_network_quotes?.polygon?.[0]
        if (!stripePolygonQuote) {
          return reply.status(500).send({ message: 'Failed to get stripe quote.' })
        }
        const finalQuote = {
          quoteId: quoteRes.quoteId,
          estSubtotalUsd: quoteRes.estSubtotalUsd,
          paymentTokenChain: POLYGON_CHAIN_ID,
          paymentTokenSymbol: pickedSourceAsset.symbol,
          paymentTokenAmount: estTotalFromAmount,
          networkFees: (Number(stripePolygonQuote.fees.network_fee_monetary) + Number(quoteRes.estFeesUsd)).toFixed(2),
          cardFees: Number(stripePolygonQuote.fees.transaction_fee_monetary).toFixed(2),
          totalUsd: Number(stripePolygonQuote.source_total_amount).toFixed(2),
        }
        return reply.send(finalQuote)
      } catch (error) {
        console.error(error)
        return reply.status(500).send({ message: 'Internal server error' })
      }
    },
  )
}
