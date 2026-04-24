import { Prisma, TransactionType } from '@prisma/client'
import getCurrentEmsision, { getEmissionFactor } from './getCurrentEmission'
import prismaClient from './prismaClient'

const MSEC_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Calculate eggs multiplier based on neynar user score
 * - If user has at least one yielding hen of level 3+, return 100% multiplier
 * - Score < 0.5 → 0.1% of eggs (0.001 multiplier)
 * - Score 0.5 → 0.1% of eggs (0.001 multiplier)
 * - Score 0.69 → 50% of eggs (0.5 multiplier) - exponential growth from 0.5
 * - Score 0.9 → 100% of eggs (1.0 multiplier)
 */
function getNeynarScoreMultiplier(
  neynarScore: number,
  hasLevel3OrHigherHen: boolean,
): number {
  // If user has at least one yielding hen of level 3 or higher, give 100% multiplier
  if (hasLevel3OrHigherHen) return 1.0

  // Clamp to minimum of 0.001 for scores below 0.5
  if (neynarScore < 0.5) return 0.001

  // First segment: 0.5 to 0.69 (0.1% to 50% - exponential growth)
  if (neynarScore <= 0.69) {
    // Exponential: multiplier = 0.001 * (500)^((score - 0.5) / 0.19)
    const normalizedProgress = (neynarScore - 0.5) / (0.69 - 0.5)
    return 0.001 * Math.pow(500, normalizedProgress)
  }

  // Second segment: 0.69 to 0.9 (50% to 100% - linear)
  if (neynarScore <= 0.9) {
    const slope = (1.0 - 0.5) / (0.9 - 0.69)
    return 0.5 + slope * (neynarScore - 0.69)
  }

  // Cap at 100% for scores above 0.9
  return 1.0
}

export async function incrementUnclaimedEggsForUser(
  userId: string,
  emissionFactor: number,
) {
  try {
    return await prismaClient.$transaction(
      async (tx) => {
        // Get user to access neynar score
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { neynarUserScore: true },
        })

        if (!user) return 0

        const hens = await tx.hen.findMany({
          where: {
            userId: userId,
            yielding: true, // Only process yielding hens
          },
        })

        if (hens.length === 0) return 0

        // Check if user has at least one yielding hen of level 3 or higher
        const hasLevel3OrHigherHen = hens.some((hen) => hen.level >= 3)

        const neynarMultiplier = getNeynarScoreMultiplier(
          user.neynarUserScore,
          hasLevel3OrHigherHen,
        )

        const currentTime = new Date()
        let newEggsProduced = 0

        for (const hen of hens) {
          const lastCollection =
            hen.lastCollected || hen.lastFertilized || hen.createdAt

          const elapsedDays =
            (currentTime.getTime() - lastCollection.getTime()) / MSEC_PER_DAY
          const eggIncrement =
            elapsedDays *
            hen.dailyYield *
            (1 - emissionFactor) *
            neynarMultiplier

          newEggsProduced += eggIncrement

          await tx.hen.update({
            where: { id: hen.id },
            data: { lastCollected: currentTime },
          })
        }

        if (newEggsProduced > 0) {
          await tx.user.update({
            where: { id: userId },
            data: {
              unclaimedEggs: { increment: newEggsProduced },
            },
          })

          await tx.eggTransaction.create({
            data: {
              userId: userId,
              amount: newEggsProduced,
              type: TransactionType.COLLECTION,
              henId: null,
            },
          })
        }

        return newEggsProduced
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 5000,
      },
    )
  } catch (error) {
    console.error(`Error processing user ${userId}:`, error)
    return 0
  }
}

export async function updateUnclaimedEggs() {
  let totalUpdatedCount = 0
  let totalNewEggs = 0
  const failedUserIds: string[] = []

  const currentEmission = await getCurrentEmsision(prismaClient)
  const emissionFactor = await getEmissionFactor(currentEmission)

  try {
    const users = await prismaClient.user.findMany()
    console.log(
      `[UNCLAIMED_EGGS] Processing egg update for ${users.length} users`,
    )

    for (const user of users) {
      try {
        const newEggs = await incrementUnclaimedEggsForUser(
          user.id,
          emissionFactor,
        )

        if (newEggs > 0) {
          totalUpdatedCount++
          totalNewEggs += newEggs
        }
      } catch {
        failedUserIds.push(user.id)
      }
    }

    console.log(
      `Completed: Added ${totalNewEggs.toFixed(2)} eggs to ${totalUpdatedCount} users`,
    )

    if (failedUserIds.length > 0) {
      console.log(
        `Failed to process ${failedUserIds.length} users: ${failedUserIds.slice(0, 5).join(', ')}${failedUserIds.length > 5 ? '...' : ''}`,
      )
    }

    return totalUpdatedCount
  } catch (error) {
    console.error('Fatal error updating unclaimed eggs:', error)
    return totalUpdatedCount
  }
}
