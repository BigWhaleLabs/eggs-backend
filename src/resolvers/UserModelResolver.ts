import { VerificationType } from '@generated/type-graphql'
import { User } from '@generated/type-graphql/models/User.js'
import { GraphQLError } from 'graphql'
import eggsContractAbi from 'helpers/eggsContractAbi'
import env from 'helpers/env'
import getClaimPeriodDates from 'helpers/getClaimPeriodDates'
import getClaimStreak from 'helpers/getClaimStreak'
import getConnectedWalletsByFID from 'helpers/getConnectedWalletsByFID'
import getCurrentEmsision, {
  getEmissionFactor,
} from 'helpers/getCurrentEmission'
import getEggBalance from 'helpers/getEggBalance'
import { checkIfAirdropUser } from 'helpers/initAirdropUsernames'
import { publicClient } from 'helpers/wallet'
import type { AuthorizedContext } from 'models/Context'
import {
  Ctx,
  Field,
  FieldResolver,
  ObjectType,
  Resolver,
  Root,
} from 'type-graphql'

@ObjectType()
class ClaimStreak {
  @Field()
  claimNumber!: number
  @Field()
  claimedToday!: boolean
}

@ObjectType()
class JackpotTicketCount {
  @Field()
  type!: string
  @Field()
  amount!: number
}

@Resolver(() => User)
export default class UserModelResolver {
  @FieldResolver(() => Boolean)
  async didClaimCurrentJackpot(
    @Root() user: User,
    @Ctx() { prisma }: AuthorizedContext,
  ) {
    const jackpotId = await publicClient.readContract({
      abi: eggsContractAbi,
      functionName: 'currentJackpotId',
      address: env.EGGS_CONTRACT_ADDRESS,
    })

    const claimed = await prisma.jackpotTicketClaimCoupon.findFirst({
      where: {
        userId: user.id,
        jackpotId: Number(jackpotId),
        used: true,
      },
    })

    const { specialTicketsStart, specialTicketsEnd } = getClaimPeriodDates()

    const unusedSpecialTickets = await prisma.jackpotTicket.findMany({
      where: {
        userId: user.id,
        claimed: false,
        type: { in: ['HOLD', 'CLAIM_STREAK'] },
        createdAt: {
          gte: specialTicketsStart,
          lt: specialTicketsEnd,
        },
      },
    })

    return !!claimed && !unusedSpecialTickets.length
  }

  @FieldResolver(() => Number)
  async totalJackpotTicketsClaimed(
    @Root() user: User,
    @Ctx() { prisma }: AuthorizedContext,
  ) {
    const jackpotId = await publicClient.readContract({
      abi: eggsContractAbi,
      functionName: 'currentJackpotId',
      address: env.EGGS_CONTRACT_ADDRESS,
    })

    const {
      regularTicketsEnd,
      regularTicketsStart,
      specialTicketsEnd,
      specialTicketsStart,
    } = getClaimPeriodDates()

    const claimed = await prisma.jackpotTicketClaimCoupon.findMany({
      where: {
        userId: user.id,
        jackpotId: Number(jackpotId),
        used: true,
        OR: [
          {
            createdAt: {
              gte: regularTicketsStart,
              lt: regularTicketsEnd,
            },
          },
          {
            createdAt: {
              gte: specialTicketsStart,
              lt: specialTicketsEnd,
            },
          },
        ],
      },
    })

    return claimed.reduce((sum, coupon) => sum + coupon.amount, 0)
  }

  @FieldResolver(() => Boolean)
  async isAirdropUser(
    @Root() user: User,
    @Ctx() { prisma }: AuthorizedContext,
  ) {
    const farcasterVerification = await prisma.verification.findFirstOrThrow({
      where: {
        userId: user.id,
        type: 'FARCASTER',
      },
    })

    if (!farcasterVerification?.subjectId) return false

    return checkIfAirdropUser(farcasterVerification?.subjectId)
  }

  @FieldResolver(() => Boolean)
  async shouldDisplayJackpotPreviewData() {
    const { specialTicketsStart, specialTicketsEnd } = getClaimPeriodDates()

    return !(
      new Date() >= specialTicketsStart && new Date() < specialTicketsEnd
    )
  }

  @FieldResolver(() => String)
  async avatar(@Root() user: User, @Ctx() { prisma }: AuthorizedContext) {
    const verifications = await prisma.verification.findFirst({
      where: {
        userId: user.id,
      },
    })

    if (!verifications) {
      return ''
    }

    return `${verifications.avatar}`
  }

  @FieldResolver(() => Number)
  async totalDailyYield(
    @Root() user: User,
    @Ctx() { prisma }: AuthorizedContext,
  ) {
    try {
      const hens = await prisma.hen.findMany({
        where: {
          userId: user.id,
        },
        select: {
          dailyYield: true,
          fertilized: true,
        },
      })

      const currentEmission = await getCurrentEmsision(prisma)
      const emissionFactor = await getEmissionFactor(currentEmission)

      const totalYield =
        hens.reduce((sum, hen) => sum + hen.dailyYield, 0) *
        (1 - emissionFactor)

      return totalYield
    } catch (error) {
      console.error('[RESOLVER] Error calculating total daily yield:', error)
      throw new GraphQLError('Failed to calculate total daily yield')
    }
  }

  @FieldResolver(() => Number)
  async getJackpotTicketsCount(
    @Root() user: User,
    @Ctx() { prisma }: AuthorizedContext,
  ) {
    const {
      specialTicketsStart,
      specialTicketsEnd,
      regularTicketsEnd,
      regularTicketsStart,
    } = getClaimPeriodDates()

    const tickets = await prisma.jackpotTicket.findMany({
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

    return tickets.reduce((sum, ticket) => sum + ticket.amount, 0)
  }

  @FieldResolver(() => [JackpotTicketCount])
  async getJackpotTickets(
    @Root() user: User,
    @Ctx() { prisma }: AuthorizedContext,
  ) {
    const {
      specialTicketsStart,
      specialTicketsEnd,
      regularTicketsEnd,
      regularTicketsStart,
    } = getClaimPeriodDates()

    const tickets = await prisma.jackpotTicket.findMany({
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
    const ticketTypeToCountMap = new Map<string, number>()
    tickets.forEach((ticket) => {
      const type = ticket.type
      const amount = ticket.amount
      if (ticketTypeToCountMap.has(type)) {
        ticketTypeToCountMap.set(
          type,
          (ticketTypeToCountMap.get(type) || 0) + amount,
        )
      } else {
        ticketTypeToCountMap.set(type, amount)
      }
    })
    return Array.from(ticketTypeToCountMap.entries()).map(([type, amount]) => ({
      type,
      amount,
    }))
  }

  @FieldResolver(() => Number)
  async eggBalance(@Root() user: User) {
    if (!user.ethAddress) {
      throw new GraphQLError('You need to connect an Ethereum wallet')
    }

    try {
      const balance = await getEggBalance(user.ethAddress as `0x${string}`)
      return Number(balance)
    } catch (error) {
      console.error('[RESOLVER] Error fetching balance:', error)
      throw new GraphQLError('Failed to fetch balance from blockchain')
    }
  }

  @FieldResolver(() => ClaimStreak)
  async claimStreak(@Root() user: User, @Ctx() { prisma }: AuthorizedContext) {
    const { claimNumber, claimedToday } = await getClaimStreak(user.id, prisma)
    return { claimNumber, claimedToday }
  }

  @FieldResolver(() => [String])
  async connectedWallets(
    @Root() user: User,
    @Ctx() { prisma }: AuthorizedContext,
  ) {
    const verification = await prisma.verification.findFirst({
      where: {
        userId: user.id,
      },
    })
    if (!verification || verification.type !== VerificationType.FARCASTER) {
      return []
    }
    const fid = +verification.subjectId
    try {
      const connectedWallets = await getConnectedWalletsByFID(fid)
      return connectedWallets
    } catch (error) {
      console.error('Error fetching connected wallets:', user.username, error)
    }
    return []
  }
}
