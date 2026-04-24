import { EggClaimCoupon } from '@generated/type-graphql/models/EggClaimCoupon'
import { Prisma } from '@prisma/client'
import { ethers } from 'ethers'
import { GraphQLError } from 'graphql'
import checkBrowserSourceHeader from 'helpers/checkBrowserSourceHeader'
import generateClaimCoupon from 'helpers/generateClaimCoupon'
import getCurrentEmsision, {
  getEmissionFactor,
} from 'helpers/getCurrentEmission'
import ignoredBurnTx from 'helpers/ignoredBurnTx'
import isUserSybil from 'helpers/isUserSybil'
import type { AuthorizedContext } from 'models/Context'
import {
  Arg,
  Authorized,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from 'type-graphql'

@ObjectType()
export class ExtendedEggClaimCoupon extends EggClaimCoupon {
  @Field()
  r!: string
  @Field()
  vs!: string
}

@ObjectType()
export class EmissionData {
  @Field()
  emission!: number
  @Field()
  factor!: number
}

@Resolver()
export default class EggResolver {
  @Query(() => EmissionData)
  async getEmissionData(@Ctx() { prisma }: AuthorizedContext) {
    const currentEmission = await getCurrentEmsision(prisma)
    const emissionFactor = await getEmissionFactor(currentEmission)

    return {
      emission: currentEmission,
      factor: emissionFactor,
    }
  }

  @Query(() => Number)
  async getBurnedEggsAmount(@Ctx() { prisma }: AuthorizedContext) {
    const result = await prisma.burnEvent.aggregate({
      _sum: {
        tokenAmount: true,
      },
      where: {
        txHash: {
          notIn: ignoredBurnTx,
        },
      },
    })

    return result._sum.tokenAmount || 0
  }

  @Authorized()
  @Mutation(() => [ExtendedEggClaimCoupon])
  async claimAllEggs(
    @Ctx() { prisma, user, source, proxyAddress }: AuthorizedContext,
    @Arg('ethAddress') ethAddress: string,
  ) {
    if (
      proxyAddress &&
      proxyAddress.toLowerCase() !== ethAddress.toLowerCase()
    ) {
      throw new GraphQLError(
        `Proxy address ${proxyAddress} does not match the provided ethAddress ${ethAddress}`,
      )
    }
    return await prisma.$transaction(
      async (tx) => {
        // Bot detection for egg claiming
        await checkBrowserSourceHeader(user, source, 'egg claim', tx)

        const latestUser = await tx.user.findUniqueOrThrow({
          where: {
            id: user.id,
          },
        })

        const sybilCheck = await isUserSybil({ id: user.id, prisma: tx })
        if (sybilCheck.isSybil) {
          if (latestUser.isVerifiedBot) {
            throw new GraphQLError(
              "You are marked as a verified sybil. Sybils can't claim. If this is a mistake, please contact support.",
            )
          }
        }

        const existingCoupons = await tx.eggClaimCoupon.findMany({
          where: {
            userId: user.id,
            used: false,
            signature: {
              not: null,
            },
            message: {
              not: null,
            },
          },
        })

        if (!latestUser.unclaimedEggs) {
          return existingCoupons.map((coupon) => {
            if (!coupon.signature || !coupon.message) {
              throw new GraphQLError('Invalid coupon')
            }
            const { r, yParityAndS } = ethers.Signature.from(coupon.signature)

            return {
              ...coupon,
              r,
              vs: yParityAndS,
            }
          })
        }

        const ticket = await tx.eggClaimCoupon.create({
          data: {
            userId: user.id,
            amount: latestUser.unclaimedEggs,
            used: false,
            address: ethAddress,
          },
        })

        const newCoupon = await generateClaimCoupon(
          BigInt(ticket.serialId),
          ethAddress as `0x${string}`,
          ticket.amount,
        )

        const updatedCoupon = await tx.eggClaimCoupon.update({
          where: { id: ticket.id },
          data: {
            message: newCoupon.message,
            signature: newCoupon.signature,
          },
        })

        await tx.user.update({
          where: { id: user.id },
          data: { unclaimedEggs: 0 },
        })

        return [...existingCoupons, updatedCoupon].map((coupon) => {
          if (!coupon.signature || !coupon.message) {
            throw new GraphQLError('Invalid coupon')
          }
          const { r, yParityAndS } = ethers.Signature.from(coupon.signature)

          return {
            ...coupon,
            r,
            vs: yParityAndS,
          }
        })
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 10000,
      },
    )
  }
}
