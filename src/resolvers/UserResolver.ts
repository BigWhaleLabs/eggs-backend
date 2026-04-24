import { JackpotTicketClaimCoupon } from '@generated/type-graphql'
import { User } from '@generated/type-graphql/models/User'
import { Prisma, TransactionType } from '@prisma/client'
import { ethers } from 'ethers'
import { GraphQLError } from 'graphql'
import checkBrowserSourceHeader from 'helpers/checkBrowserSourceHeader'
import { MIN_NEYNAR_SCORE } from 'helpers/consts'
import eggsContractAbi from 'helpers/eggsContractAbi'
import env from 'helpers/env'
import { generateJackpotTicketsClaimCoupon } from 'helpers/generateClaimCoupon'
import { MAX_CODE_USES, getOrCreateCockCode } from 'helpers/generateCockCodes'
import getClaimPeriodDates from 'helpers/getClaimPeriodDates'
import { isWithinClaimRange } from 'helpers/giveJackpotTickets'
import isUserSybil from 'helpers/isUserSybil'
import sendFarcasterNotification from 'helpers/sendFarcasterNotification'
import { publicClient } from 'helpers/wallet'
import type Context from 'models/Context'
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
import { ExtendedEggClaimCoupon } from './EggsResolver'

@ObjectType()
class CockCodeInfo {
  @Field()
  id!: string

  @Field()
  code!: string

  @Field()
  expiresAt!: Date

  @Field()
  usesLeft!: number
}

@ObjectType()
export class ExtendedJackpotTicketClaimCoupon extends JackpotTicketClaimCoupon {
  @Field()
  r!: string
  @Field()
  vs!: string
}

@ObjectType()
class VerifiedBotInfo {
  @Field()
  username!: string

  @Field()
  fid!: string
}

@ObjectType()
class VerifiedBots {
  @Field(() => [VerifiedBotInfo])
  bots!: VerifiedBotInfo[]
}

@ObjectType()
class UserQueryResult {
  @Field()
  id!: string

  @Field()
  serialId!: number

  @Field()
  username!: string

  @Field()
  neynarUserScore!: number

  @Field()
  totalHoldings!: number

  @Field({ nullable: true })
  fid!: string | null
}

@Resolver()
export class UserResolver {
  @Authorized()
  @Query(() => [ExtendedJackpotTicketClaimCoupon], {
    nullable: true,
  })
  async unclaimedJackpotCoupons(
    @Ctx() { prisma, user, source }: AuthorizedContext,
  ) {
    // Bot detection for jackpot coupon access
    await checkBrowserSourceHeader(
      user,
      source,
      'jackpot coupon access',
      prisma,
    )

    const jackpotId = await publicClient.readContract({
      abi: eggsContractAbi,
      functionName: 'currentJackpotId',
      address: env.EGGS_CONTRACT_ADDRESS,
    })

    const coupons = await prisma.jackpotTicketClaimCoupon.findMany({
      where: {
        userId: user.id,
        jackpotId: Number(jackpotId),
        used: false,
      },
    })

    if (!coupons.length) return []

    return coupons.map((coupon) => {
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

  @Authorized()
  @Query(() => User)
  async getUser(
    @Arg('username') username: string,
    @Ctx() { prisma, user }: AuthorizedContext,
  ) {
    if (!user.isAdmin) throw new GraphQLError('Unauthorized')

    return await prisma.user.findFirst({
      where: {
        username,
      },
    })
  }

  @Authorized()
  @Mutation(() => [ExtendedJackpotTicketClaimCoupon])
  async claimJackpotTickets(
    @Ctx() { prisma, user, source }: AuthorizedContext,
    @Arg('ethAddress') ethAddress: string,
  ): Promise<Array<ExtendedJackpotTicketClaimCoupon>> {
    // Bot detection for jackpot ticket claiming
    await checkBrowserSourceHeader(
      user,
      source,
      'jackpot ticket claiming',
      prisma,
    )

    if (!isWithinClaimRange()) {
      throw new GraphQLError(
        'Jackpot ticket claiming is only available from Monday 2pm to Tuesday 2pm PST.',
      )
    }

    const isClaimsOpen = await publicClient.readContract({
      abi: eggsContractAbi,
      functionName: 'jackpotTicketClaimsOpen',
      address: env.EGGS_CONTRACT_ADDRESS,
    })

    if (!isClaimsOpen) {
      throw new GraphQLError(
        'Jackpot ticket claiming is currently closed. Please check back later.',
      )
    }

    const sybilCheck = await isUserSybil({
      prisma,
      id: user.id,
    })

    const isPreviousWinner = await prisma.eggTransaction.findFirst({
      where: {
        type: TransactionType.JACKPOT_REWARD,
        userId: user.id,
        createdAt: {
          gte: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        },
      },
    })

    if (isPreviousWinner) {
      throw new GraphQLError(
        'Winners of the previous jackpot are not eligible to claim tickets for the next jackpot.',
      )
    }

    if (sybilCheck.isSybil) {
      const errorMessage = user.isVerifiedBot
        ? "You are marked as a verified sybil. Sybils can't participate. If this is a mistake, please contact support."
        : `You need neynar score of ${MIN_NEYNAR_SCORE} or higher to participate. Be more active on Farcaster or upgrade a chicken to level 3 to be eligible!${
            sybilCheck.message ? ` ${sybilCheck.message}` : ''
          }`
      throw new GraphQLError(errorMessage)
    }

    const jackpotId = await publicClient.readContract({
      abi: eggsContractAbi,
      functionName: 'currentJackpotId',
      address: env.EGGS_CONTRACT_ADDRESS,
    })

    const existingJackpotCoupons =
      await prisma.jackpotTicketClaimCoupon.findMany({
        where: {
          userId: user.id,
          jackpotId: Number(jackpotId),
          used: false,
        },
      })

    const {
      regularTicketsStart,
      regularTicketsEnd,
      specialTicketsStart,
      specialTicketsEnd,
    } = getClaimPeriodDates()

    const unclaimedTickets = await prisma.jackpotTicket.findMany({
      where: {
        userId: user.id,
        claimed: false,
        OR: [
          {
            type: { notIn: ['HOLD', 'CLAIM_STREAK'] },
            createdAt: {
              gte: regularTicketsStart,
              lt: regularTicketsEnd,
            },
          },
          {
            type: { in: ['HOLD', 'CLAIM_STREAK'] },
            createdAt: {
              gte: specialTicketsStart,
              lt: specialTicketsEnd,
            },
          },
        ],
      },
    })

    if (existingJackpotCoupons.length && !unclaimedTickets.length) {
      const unusedCoupons = existingJackpotCoupons.filter(
        (coupon) => !coupon.used,
      )

      if (!unusedCoupons.length) {
        throw new GraphQLError('You have already claimed your tickets')
      }

      return unusedCoupons.map((coupon) => {
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

    return await prisma.$transaction(
      async (tx) => {
        const {
          regularTicketsStart,
          regularTicketsEnd,
          specialTicketsStart,
          specialTicketsEnd,
        } = getClaimPeriodDates()

        const existingJackpotCoupons =
          await prisma.jackpotTicketClaimCoupon.findMany({
            where: {
              userId: user.id,
              jackpotId: Number(jackpotId),
              used: false,
            },
          })

        const unclaimedTickets = await tx.jackpotTicket.findMany({
          where: {
            userId: user.id,
            claimed: false,
            OR: [
              {
                type: { notIn: ['HOLD', 'CLAIM_STREAK'] },
                createdAt: {
                  gte: regularTicketsStart,
                  lt: regularTicketsEnd,
                },
              },
              {
                type: { in: ['HOLD', 'CLAIM_STREAK'] },
                createdAt: {
                  gte: specialTicketsStart,
                  lt: specialTicketsEnd,
                },
              },
            ],
          },
        })

        if (!unclaimedTickets.length) {
          throw new GraphQLError('No unclaimed tickets found')
        }

        const totalClaimed = unclaimedTickets.reduce(
          (acc, ticket) => acc + Number(ticket.amount),
          0,
        )

        const ticketsClaimCoupon = await tx.jackpotTicketClaimCoupon.create({
          data: {
            userId: user.id,
            amount: totalClaimed,
            used: false,
            address: ethAddress,
            jackpotId: Number(jackpotId),
          },
        })

        const ticketsClaimCouponData = await generateJackpotTicketsClaimCoupon({
          ticketId: BigInt(ticketsClaimCoupon.serialId),
          userId: user.serialId,
          jackpotId,
          numberOfTickets: totalClaimed,
        })

        const updatedTicketsClaimCoupon =
          await tx.jackpotTicketClaimCoupon.update({
            where: { id: ticketsClaimCoupon.id },
            data: {
              message: ticketsClaimCouponData.message,
              signature: ticketsClaimCouponData.signature,
            },
          })

        await tx.jackpotTicket.updateMany({
          where: {
            userId: user.id,
            claimed: false,
            OR: [
              {
                type: { notIn: ['HOLD', 'CLAIM_STREAK'] },
                createdAt: {
                  gte: regularTicketsStart,
                  lt: regularTicketsEnd,
                },
              },
              {
                type: { in: ['HOLD', 'CLAIM_STREAK'] },
                createdAt: {
                  gte: specialTicketsStart,
                  lt: specialTicketsEnd,
                },
              },
            ],
          },
          data: {
            claimed: true,
          },
        })

        if (
          !updatedTicketsClaimCoupon.signature ||
          !updatedTicketsClaimCoupon.message
        ) {
          throw new GraphQLError('Invalid coupon')
        }

        const { r, yParityAndS } = ethers.Signature.from(
          updatedTicketsClaimCoupon.signature,
        )

        const coupons = [
          {
            ...updatedTicketsClaimCoupon,
            r,
            vs: yParityAndS,
          },
        ]

        if (existingJackpotCoupons.length > 0) {
          existingJackpotCoupons.forEach((ticket) => {
            if (ticket.signature && ticket.message) {
              const { r, yParityAndS } = ethers.Signature.from(ticket.signature)

              coupons.push({
                ...ticket,
                r,
                vs: yParityAndS,
              })
            }
          })
        }

        return coupons
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30_000,
      },
    )
  }

  @Authorized()
  @Query(() => CockCodeInfo)
  async getMyCockCode(@Ctx() { prisma, user }: AuthorizedContext) {
    const cockCode = await getOrCreateCockCode(prisma, user.id)

    if (!cockCode) {
      throw new GraphQLError('Failed to generate cock code')
    }

    const usesLeft = Math.max(0, MAX_CODE_USES - cockCode.hens.length)

    return {
      id: cockCode.id,
      code: cockCode.code,
      usesLeft: usesLeft,
    }
  }

  @Authorized()
  @Query(() => [ExtendedEggClaimCoupon])
  async getMyUnclaimedCoupons(@Ctx() { prisma, user }: AuthorizedContext) {
    const unusedCoupons = await prisma.eggClaimCoupon.findMany({
      where: {
        userId: user.id,
        used: false,
      },
    })

    return unusedCoupons.map((coupon) => {
      if (!coupon.signature) throw new GraphQLError('Invalid coupon')
      const { r, yParityAndS } = ethers.Signature.from(coupon.signature)

      return {
        ...coupon,
        r,
        vs: yParityAndS,
      }
    })
  }

  @Authorized()
  @Query(() => User)
  getMe(@Ctx() { user }: AuthorizedContext) {
    return user
  }

  @Authorized()
  @Mutation(() => Boolean)
  async sendNotifications(
    @Ctx() { user, prisma }: AuthorizedContext,
    @Arg('title') title: string,
    @Arg('body') body: string,
  ) {
    if (!user.isAdmin) {
      throw new GraphQLError('Unauthorized')
    }
    if (!title || !body) {
      throw new GraphQLError('Title and body are required')
    }
    if (title.length > 32) {
      throw new GraphQLError('Title is too long')
    }
    if (body.length > 128) {
      throw new GraphQLError('Body is too long')
    }
    const notificationTokens =
      await prisma.farcasterNotificationToken.findMany()
    const batchSize = 100
    console.log(
      `[NOTIFICATIONS] Sending ${notificationTokens.length} notifications`,
    )
    console.log('[NOTIFICATIONS]', title)
    console.log('[NOTIFICATIONS]', body)
    for (let i = 0; i < notificationTokens.length; i += batchSize) {
      console.log(
        `[NOTIFICATIONS] Sending batch ${i / batchSize + 1} of ${Math.ceil(notificationTokens.length / batchSize)}`,
      )
      const batch = notificationTokens.slice(i, i + batchSize)
      const tokens = batch.map((token) => token.token)
      await sendFarcasterNotification({
        url: batch[0].url,
        token: tokens,
        title,
        body,
        targetUrl: 'https://eggs.name',
      })
    }
    console.log('[NOTIFICATIONS] Notifications sent')
    return true
  }

  @Query(() => VerifiedBots)
  async verifiedBots(@Ctx() { prisma }: Context) {
    const verifiedBots = await prisma.user.findMany({
      where: {
        isVerifiedBot: true,
        verifications: {
          some: {
            type: 'FARCASTER',
          },
        },
      },
      select: {
        username: true,
        verifications: {
          where: {
            type: 'FARCASTER',
          },
          select: {
            subjectId: true,
          },
        },
      },
    })

    // Extract usernames and FIDs from users that have Farcaster verifications
    const bots: VerifiedBotInfo[] = []
    for (const user of verifiedBots) {
      for (const verification of user.verifications) {
        bots.push({
          username: user.username,
          fid: verification.subjectId,
        })
      }
    }

    return { bots }
  }

  @Query(() => UserQueryResult, { nullable: true })
  async getUserByFid(@Arg('fid') fid: string, @Ctx() { prisma }: Context) {
    const user = await prisma.user.findFirst({
      where: {
        verifications: {
          some: {
            subjectId: fid,
            type: 'FARCASTER',
          },
        },
      },
      select: {
        id: true,
        serialId: true,
        username: true,
        neynarUserScore: true,
        totalHoldings: true,
        verifications: {
          where: {
            type: 'FARCASTER',
          },
          select: {
            subjectId: true,
          },
        },
      },
    })

    if (!user) return null

    return {
      ...user,
      fid: user.verifications[0]?.subjectId || null,
      verifications: undefined, // Remove verifications from the response
    }
  }

  @Query(() => [UserQueryResult])
  async getLeaderboard(@Ctx() { prisma }: Context) {
    const users = await prisma.user.findMany({
      where: {
        totalHoldings: {
          gt: 15000,
        },
        verifications: {
          some: {
            type: 'FARCASTER',
          },
        },
      },
      select: {
        id: true,
        serialId: true,
        username: true,
        neynarUserScore: true,
        totalHoldings: true,
        verifications: {
          where: {
            type: 'FARCASTER',
          },
          select: {
            subjectId: true,
          },
        },
      },
      orderBy: {
        totalHoldings: 'desc',
      },
    })

    return users.map((user) => ({
      ...user,
      fid: user.verifications[0]?.subjectId || null,
      verifications: undefined, // Remove verifications from the response
    }))
  }
}
