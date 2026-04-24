import prismaClient from 'helpers/prismaClient'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import markJackpotCouponUsed from './markJackpotCouponUsed'
import { createResilientEventListener } from './resilientEventListener'
import { publicClient } from './wallet'

export async function checkHistoricalJackpotTickets() {
  console.log(
    '[JACKPOT_LISTENER] Checking historical jackpot ticket redemptions...',
  )
  const currentBlock = await publicClient.getBlockNumber()

  try {
    const unusedCoupons = await prismaClient.jackpotTicketClaimCoupon.findMany({
      where: {
        used: false,
      },
    })

    if (unusedCoupons.length === 0) {
      console.log('No pending jackpot tickets to check')
      return
    }

    console.log(
      `Checking ${unusedCoupons.length} pending jackpot tickets against blockchain...`,
    )

    const pendingTicketIds = new Set(
      unusedCoupons.map((ticket) => String(ticket.serialId)),
    )

    const MAX_BLOCKS = 50_000n
    const BATCH_SIZE = 10_000n
    let totalUpdatedCount = 0
    let endBlock = currentBlock

    while (
      endBlock > currentBlock - MAX_BLOCKS &&
      endBlock > 0n &&
      pendingTicketIds.size > 0
    ) {
      const startBlock = endBlock > BATCH_SIZE ? endBlock - BATCH_SIZE : 0n
      console.log(
        `[JACKPOT_LISTENER] Checking blocks ${startBlock} to ${endBlock}...`,
      )

      const events = await publicClient.getContractEvents({
        abi: eggsContractAbi,
        address: env.EGGS_CONTRACT_ADDRESS,
        eventName: 'JackpotTicketClaimed',
        fromBlock: startBlock,
        toBlock: endBlock,
      })

      const updatePromises = events.map(async (log) => {
        const ticketId = log.args.ticketId?.toString()
        if (ticketId && pendingTicketIds.has(ticketId)) {
          pendingTicketIds.delete(ticketId)
          return markJackpotCouponUsed(Number(ticketId))
        }
        return false
      })

      const results = await Promise.all(updatePromises)
      const batchUpdatedCount = results.filter((result) => result).length
      totalUpdatedCount += batchUpdatedCount
      endBlock = startBlock - 1n

      if (pendingTicketIds.size === 0) {
        console.log('All pending jackpot tickets processed, stopping early')
        break
      }
    }

    console.log(
      `Historical jackpot check complete: ${totalUpdatedCount} tickets marked as used`,
    )
  } catch (error) {
    console.error('Error checking historical jackpot tickets:', error)
  }
}

export async function startJackpotTicketEventListener() {
  console.log('[JACKPOT_LISTENER] Starting jackpot ticket event listener...')
  await checkHistoricalJackpotTickets()

  const unwatch = await createResilientEventListener({
    name: 'JACKPOT_LISTENER',
    createListener: async () => {
      return publicClient.watchContractEvent({
        address: env.EGGS_CONTRACT_ADDRESS,
        abi: eggsContractAbi,
        strict: true,
        eventName: 'JackpotTicketClaimed',
        onLogs: async (logs) => {
          try {
            for (const log of logs) {
              const ticketId = log.args.ticketId.toString()
              if (ticketId) {
                await markJackpotCouponUsed(Number(ticketId))
              }
            }
          } catch (error) {
            console.error('Error processing jackpot ticket event:', error)
          }
        },
      })
    },
  })

  return unwatch
}
