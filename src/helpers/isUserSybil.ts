import type { Prisma, PrismaClient } from '@prisma/client'
import { MIN_NEYNAR_SCORE } from './consts'
import { checkIfAirdropUser } from './initAirdropUsernames'
import prismaClient from './prismaClient'

export default async function isUserSybil({
  id,
  prisma = prismaClient,
  minChickenLevel = 3,
}: {
  id: string
  prisma?: PrismaClient | Prisma.TransactionClient
  minChickenLevel?: number
}): Promise<{ isSybil: boolean; message?: string }> {
  const user = await prisma.user.findUnique({
    where: {
      id,
    },
    select: {
      neynarUserScore: true,
      totalHoldings: true,
      hens: {
        select: {
          level: true,
          lastTransferred: true,
        },
      },
      isVerifiedBot: true,
      verifications: {
        select: {
          subjectId: true,
          type: true,
        },
      },
    },
  })
  if (!user) throw new Error('User not found when checking if a sybil')

  const farcasterVerification = user.verifications.find(
    (verification) => verification.type === 'FARCASTER',
  )
  if (!farcasterVerification?.subjectId) {
    return { isSybil: true, message: 'No Farcaster verification found.' }
  }

  if (user.isVerifiedBot) {
    return { isSybil: true, message: 'Verified bots are considered sybils.' }
  }

  // Check if user holds at least 15,000 $EGGS - they can bypass other requirements
  if (user.totalHoldings >= 15000) {
    return { isSybil: false }
  }

  // Check if user meets basic criteria
  if (user.neynarUserScore >= MIN_NEYNAR_SCORE) {
    return { isSybil: false }
  }

  if (checkIfAirdropUser(farcasterVerification.subjectId)) {
    return { isSybil: false }
  }

  // Check chickens for minimum level requirement
  const now = new Date()
  const thirtySevenHoursAgo = new Date(now.getTime() - 36 * 60 * 60 * 1000)

  // Find eligible chickens (not transferred within 36 hours)
  const eligibleHighLevelChickens = user.hens.filter(
    (hen) =>
      hen.level >= minChickenLevel &&
      (!hen.lastTransferred || hen.lastTransferred <= thirtySevenHoursAgo),
  )

  if (eligibleHighLevelChickens.length > 0) {
    return { isSybil: false }
  }

  // Check if user has high-level chickens that are still in cooldown period
  const cooldownChickens = user.hens.filter(
    (hen) =>
      hen.level >= minChickenLevel &&
      hen.lastTransferred &&
      hen.lastTransferred > thirtySevenHoursAgo,
  )

  if (cooldownChickens.length > 0) {
    return {
      isSybil: true,
      message:
        'Transferred chickens start working 36 hours after the transfer.',
    }
  }

  return { isSybil: true, message: 'No eligible high-level chickens found.' }
}
