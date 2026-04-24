import { Prisma } from '@prisma/client'
import prismaClient from './prismaClient'

// Exponential backoff retry utility
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      // Check if it's a transaction conflict error
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          error.message.includes('write conflict') ||
          error.message.includes('deadlock'))
      ) {
        if (attempt === maxRetries) {
          throw error // Last attempt, re-throw the error
        }

        // Calculate delay with exponential backoff + jitter
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100
        console.log(
          `Transaction conflict on attempt ${attempt + 1}, retrying in ${delay}ms...`,
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      // If it's not a transaction conflict, throw immediately
      throw error
    }
  }

  throw new Error('Unexpected end of retry loop')
}

export default async function markCouponUsed(ticketId: number) {
  try {
    return await retryWithBackoff(async () => {
      return await prismaClient.$transaction(
        async (tx) => {
          const ticket = await tx.eggClaimCoupon.findFirst({
            where: {
              serialId: ticketId,
              used: false,
            },
            include: {
              user: true,
            },
          })

          if (!ticket) {
            console.log(`Ticket not found or already used: ${ticketId}`)
            return false
          }

          await tx.eggClaimCoupon.update({
            where: { id: ticket.id },
            data: { used: true },
          })

          console.log(`[COUPON_USED] Ticket ${ticketId} marked as used`)
          return true
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, // Less strict
          timeout: 10_000, // Reduced timeout
        },
      )
    }, 3) // Retry up to 3 times
  } catch (error) {
    console.error(
      `Error marking ticket ${ticketId} as used after retries:`,
      error,
    )
    return false
  }
}
