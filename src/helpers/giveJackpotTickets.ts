import type { JackpotTicketType, Prisma } from '@prisma/client'
import { DateTime } from 'luxon'

export function giveJackpotTickets(
  tx: Prisma.TransactionClient,
  amount: number,
  userId: string,
  type: JackpotTicketType,
) {
  return tx.jackpotTicket.create({
    data: {
      userId,
      amount,
      type,
    },
  })
}

export function isWithinClaimRange() {
  const now = DateTime.now().setZone('America/Los_Angeles')

  const currentWeekMonday = now.startOf('week')
  const claimWindowStart = currentWeekMonday.set({
    hour: 14,
    minute: 0,
    second: 0,
    millisecond: 0,
  })
  const claimWindowEnd = claimWindowStart.plus({ days: 1 })

  return now >= claimWindowStart && now <= claimWindowEnd
}
