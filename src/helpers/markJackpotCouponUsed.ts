import { Prisma } from '@prisma/client'
import prismaClient from './prismaClient'

export default async function markJackpotCouponUsed(ticketId: number) {
  try {
    return await prismaClient.$transaction(
      async (tx) => {
        const ticket = await tx.jackpotTicketClaimCoupon.findFirst({
          where: {
            serialId: ticketId,
            used: false,
          },
          include: {
            user: true,
          },
        })

        if (!ticket) {
          console.log(`Jackpot ticket not found or already used: ${ticketId}`)
          return false
        }

        await tx.jackpotTicketClaimCoupon.update({
          where: { id: ticket.id },
          data: { used: true },
        })

        console.log(
          `[JACKPOT_COUPON_USED] Jackpot ticket ${ticketId} marked as used`,
        )
        return true
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 30_000,
      },
    )
  } catch (error) {
    console.error(`Error marking jackpot ticket ${ticketId} as used:`, error)
    return false
  }
}
