import type { Prisma } from '@prisma/client'
import { DateTime } from 'luxon'

export default async function getClaimStreak(
  userId: string,
  prisma: Prisma.TransactionClient,
) {
  const laZone = 'America/Los_Angeles'

  const nowLA = DateTime.now().setZone(laZone)
  const todayLA = nowLA.startOf('day')

  const eightDaysAgoLA = todayLA.minus({ days: 8 })
  const eightDaysAgo = eightDaysAgoLA.toJSDate()

  const coupons = await prisma.eggClaimCoupon.findMany({
    where: {
      userId: userId,
      createdAt: {
        gte: eightDaysAgo,
      },
    },
    select: {
      createdAt: true,
    },
  })

  const claimDayMap = new Map<string, boolean>()

  coupons.forEach((coupon) => {
    const claimDateLA = DateTime.fromJSDate(coupon.createdAt).setZone(laZone)
    const dayKey = claimDateLA.toFormat('yyyy-MM-dd')
    claimDayMap.set(dayKey, true)
  })

  const todayKey = todayLA.toFormat('yyyy-MM-dd')
  const claimedToday = claimDayMap.has(todayKey)

  const yesterdayKey = todayLA.minus({ days: 1 }).toFormat('yyyy-MM-dd')
  const claimedYesterday = claimDayMap.has(yesterdayKey)

  if (!claimedYesterday) {
    if (claimedToday) {
      return {
        claimNumber: 1,
        claimedToday: true,
      }
    }
    return {
      claimNumber: 0,
      claimedToday: false,
    }
  }

  let streakDays = 1

  for (let i = 2; i <= 7; i++) {
    const checkKey = todayLA.minus({ days: i }).toFormat('yyyy-MM-dd')
    if (!claimDayMap.has(checkKey)) {
      break
    }
    streakDays++
  }

  if (claimedToday) {
    streakDays++
  }

  streakDays = Math.min(streakDays, 7)

  return {
    claimNumber: streakDays,
    claimedToday: claimedToday,
  }
}
