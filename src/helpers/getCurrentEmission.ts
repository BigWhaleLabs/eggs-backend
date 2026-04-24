import type { Prisma } from '@prisma/client'
import { DateTime } from 'luxon'

export default async function getCurrentEmission(tx: Prisma.TransactionClient) {
  // Get the current time in LA time zone and calculate LA midnight.
  const nowLA = DateTime.now().setZone('America/Los_Angeles')
  const todayStartLA = nowLA.startOf('day')
  // Convert the Luxon DateTimes to JavaScript Date objects for Prisma.
  const todayStart = todayStartLA.toJSDate()
  const now = DateTime.now().toJSDate()

  // Sum amounts from EggTransaction for the time range, only for emission-counted types
  const eggTransactions = await tx.eggTransaction.aggregate({
    where: {
      createdAt: {
        gte: todayStart,
        lt: now,
      },
      type: {
        in: [
          'COLLECTION',
          'REFERRAL_REWARD',
          'JACKPOT_REWARD',
          'BURN_REWARD',
          'STAKING_REWARD',
          'TIP_RECEIVED',
        ],
      },
    },
    _sum: { amount: true },
  })

  // Sum both amounts and return the total.
  const totalEggTransactions = eggTransactions._sum.amount || 0
  return totalEggTransactions
}

export async function getEmissionFactor(emission: number) {
  if (emission <= 50_000) return 0
  else if (emission >= 50_000 && emission <= 100_000) return 0.1
  else if (emission >= 100_000 && emission <= 150_000) return 0.25
  else if (emission >= 150_000 && emission <= 200_000) return 0.35
  else if (emission >= 200_000 && emission <= 250_000) return 0.55
  else if (emission >= 250_000 && emission <= 300_000) return 0.75
  else return 0.9
}
