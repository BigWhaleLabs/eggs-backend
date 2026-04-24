import prismaClient from 'helpers/prismaClient'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import markTicketUsed from './markCouponUsed'
import { createResilientEventListener } from './resilientEventListener'
import { publicClient } from './wallet'

export async function checkAllTicketsOnChain() {
  try {
    console.log(
      '[TICKET_CHECKER] 🔍 Starting to check all tickets against blockchain...',
    )

    const BATCH_SIZE = 100

    // Get all unclaimed tickets from database
    const unclaimedTickets = await prismaClient.eggClaimCoupon.findMany({
      where: {
        used: false,
      },
      include: {
        user: true,
      },
      orderBy: {
        serialId: 'asc',
      },
    })

    console.log(
      `[TICKET_CHECKER] Found ${unclaimedTickets.length} unclaimed tickets in database`,
    )

    const totalBatches = Math.ceil(unclaimedTickets.length / BATCH_SIZE)
    let checkedCount = 0
    let markedUsedCount = 0

    // Process tickets in batches
    for (let i = 0; i < unclaimedTickets.length; i += BATCH_SIZE) {
      const batch = unclaimedTickets.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1

      console.log(
        `[TICKET_CHECKER] 📦 Batch ${batchNumber}/${totalBatches}: Checking ${batch.length} tickets (${i + 1}-${i + batch.length})`,
      )

      const startTime = Date.now()

      // Check each ticket in the batch against the blockchain
      for (const ticket of batch) {
        try {
          const isClaimed = await publicClient.readContract({
            abi: eggsContractAbi,
            address: env.EGGS_CONTRACT_ADDRESS,
            functionName: 'claimedTickets',
            args: [BigInt(ticket.user.serialId), BigInt(ticket.serialId)],
          })

          checkedCount++

          if (isClaimed) {
            console.log(
              `[TICKET_CHECKER] ⚠️  Ticket ${ticket.serialId} (user: ${ticket.user.username}) is claimed on-chain but not marked in DB`,
            )

            // Mark the ticket as used in the database
            const result = await markTicketUsed(ticket.serialId)
            if (result) {
              markedUsedCount++
            }
          }
        } catch (error) {
          console.error(
            `[TICKET_CHECKER] Error checking ticket ${ticket.serialId}:`,
            error,
          )
        }
      }

      const batchTime = Date.now() - startTime
      console.log(
        `[TICKET_CHECKER] ✅ Batch ${batchNumber} complete in ${batchTime}ms`,
      )

      // Add a small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < unclaimedTickets.length) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    console.log(
      `[TICKET_CHECKER] 🎉 FINAL SUMMARY:\n` +
        `  📊 Total tickets checked: ${checkedCount}\n` +
        `  ✅ Tickets marked as used: ${markedUsedCount}\n` +
        `  🔗 Unclaimed in DB and on-chain: ${checkedCount - markedUsedCount}`,
    )
  } catch (error) {
    console.error('[TICKET_CHECKER] ❌ Error checking tickets:', error)
  }
}

export async function processMissedTicketEvents() {
  try {
    console.log('[TICKET_LISTENER] 🔍 Checking for missed ticket events...')

    const currentBlock = await publicClient.getBlockNumber()

    // Get the last processed block from database
    let lastProcessedBlock = await prismaClient.ticketProcessedBlock.findFirst()

    if (!lastProcessedBlock) {
      // If no record exists, start from a reasonable block in the past
      const startBlock = 27597199n
      lastProcessedBlock = await prismaClient.ticketProcessedBlock.create({
        data: {
          blockNumber: startBlock,
        },
      })
      console.log(
        `[TICKET_LISTENER] Initialized last processed block to ${startBlock}`,
      )
    }

    const START_BLOCK = lastProcessedBlock.blockNumber + 1n
    const BATCH_SIZE = 1_000n

    // Skip if we're already caught up
    if (START_BLOCK > currentBlock) {
      console.log(
        `[TICKET_LISTENER] Already caught up to block ${currentBlock}, no events to process`,
      )
      return
    }

    const totalBlocks = currentBlock - START_BLOCK
    console.log(
      `[TICKET_LISTENER] 🚀 Starting ticket events check - scanning from block ${START_BLOCK} to ${currentBlock} (${totalBlocks} blocks) in batches of ${BATCH_SIZE}`,
    )

    let processedCount = 0
    let batchCount = 0
    let startBlock = START_BLOCK

    while (startBlock <= currentBlock) {
      const endBlock =
        startBlock + BATCH_SIZE > currentBlock
          ? currentBlock
          : startBlock + BATCH_SIZE
      batchCount++

      const progress =
        totalBlocks > 0n
          ? Number(((startBlock - START_BLOCK) * 100n) / totalBlocks)
          : 100
      console.log(
        `[TICKET_LISTENER] 📦 Batch ${batchCount}: Checking blocks ${startBlock} to ${endBlock}... (${progress}% complete)`,
      )

      const startTime = Date.now()

      const events = await publicClient.getContractEvents({
        abi: eggsContractAbi,
        address: env.EGGS_CONTRACT_ADDRESS,
        eventName: 'ClaimedEggs',
        fromBlock: startBlock,
        toBlock: endBlock,
      })

      const fetchTime = Date.now() - startTime
      console.log(
        `[TICKET_LISTENER] 📊 Batch ${batchCount}: Found ${events.length} ClaimedEggs events (fetched in ${fetchTime}ms)`,
      )

      for (const log of events) {
        const ticketId = log.args.ticketId?.toString()
        if (ticketId) {
          try {
            const result = await markTicketUsed(Number(ticketId))
            if (result) {
              processedCount++
            }
          } catch (error) {
            console.error(
              `[TICKET_LISTENER] Error processing ticket ${ticketId}:`,
              error,
            )
          }
        }
      }

      const processTime = Date.now() - startTime
      console.log(
        `[TICKET_LISTENER] ✅ Batch ${batchCount} complete in ${processTime}ms`,
      )

      // Move to next batch
      startBlock = endBlock + 1n
    }

    // Update the last processed block
    await prismaClient.ticketProcessedBlock.update({
      where: {
        id: lastProcessedBlock.id,
      },
      data: {
        blockNumber: currentBlock,
      },
    })

    console.log(
      `[TICKET_LISTENER] 🎉 FINAL SUMMARY:\n` +
        `  📦 Batches processed: ${batchCount}\n` +
        `  ✅ Tickets updated: ${processedCount}\n` +
        `  🔗 Last processed block: ${currentBlock}`,
    )
  } catch (error) {
    console.error('[TICKET_LISTENER] ❌ Error processing missed events:', error)
  }
}

export async function startTicketEventListener() {
  console.log('[TICKET_LISTENER] 🚀 Starting ticket event listener...')

  // Process missed events in the background without blocking
  void processMissedTicketEvents()

  const unwatch = await createResilientEventListener({
    name: 'TICKET_LISTENER',
    createListener: async () => {
      return publicClient.watchContractEvent({
        address: env.EGGS_CONTRACT_ADDRESS,
        abi: eggsContractAbi,
        eventName: 'ClaimedEggs',
        onLogs: async (logs) => {
          console.log(
            `[TICKET_LISTENER] 📥 Received ${logs.length} new ticket events`,
          )
          for (const log of logs) {
            try {
              const ticketId = log.args.ticketId?.toString()
              if (ticketId) {
                const { blockNumber } = log
                await markTicketUsed(Number(ticketId))

                // Update the last processed block for real-time events
                const existingRecord =
                  await prismaClient.ticketProcessedBlock.findFirst()
                if (existingRecord) {
                  await prismaClient.ticketProcessedBlock.update({
                    where: {
                      id: existingRecord.id,
                    },
                    data: {
                      blockNumber: BigInt(blockNumber),
                    },
                  })
                } else {
                  await prismaClient.ticketProcessedBlock.create({
                    data: {
                      blockNumber: BigInt(blockNumber),
                    },
                  })
                }
              }
            } catch (error) {
              console.error(
                '[TICKET_LISTENER] ❌ Error processing ticket event:',
                error,
              )
            }
          }
        },
      })
    },
  })

  console.log('[TICKET_LISTENER] ✅ Ticket event listener started')
  return unwatch
}
