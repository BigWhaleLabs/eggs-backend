import eggsContractAbi from './eggsContractAbi'
import env from './env'
import prismaClient from './prismaClient'
import proccessExtraChickenSet from './proccessExtraChickenSet'
import { publicClient } from './wallet'

export default async function checkMissedExtraChickenEvents() {
  try {
    const currentBlock = await publicClient.getBlockNumber()

    // Get the last processed block from database
    let lastProcessedBlock =
      await prismaClient.extraChickenProcessedBlock.findFirst()

    if (!lastProcessedBlock) {
      // If no record exists, start from 10,000 blocks ago
      const startBlock = currentBlock - 10_000n
      lastProcessedBlock = await prismaClient.extraChickenProcessedBlock.create(
        {
          data: {
            blockNumber: startBlock,
          },
        },
      )
      console.log(
        `[EXTRA_CHICKEN_EVENTS] Initialized last processed block to ${startBlock}`,
      )
    }

    const fromBlock = lastProcessedBlock.blockNumber + 1n

    // Skip if we're already caught up
    if (fromBlock > currentBlock) {
      console.log(
        `[EXTRA_CHICKEN_EVENTS] Already caught up to block ${currentBlock}, no events to process`,
      )
      return {
        eventsProcessed: 0,
        hensCreated: 0,
      }
    }

    console.log(
      `[EXTRA_CHICKEN_EVENTS] 🚀 Checking for missed extra chicken events from block ${fromBlock} to ${currentBlock}`,
    )

    const logs = await publicClient.getContractEvents({
      address: env.EGGS_CONTRACT_ADDRESS,
      abi: eggsContractAbi,
      eventName: 'ExtraChickensSet',
      fromBlock,
      toBlock: currentBlock,
    })

    console.log(
      `[EXTRA_CHICKEN_EVENTS] 📊 Found ${logs.length} ExtraChickensSet events`,
    )

    let processedCount = 0
    for (const log of logs) {
      const userId = Number(log.args.userId)
      const extraChickens = Number(log.args.extraChickens)

      try {
        const hensCreated = await proccessExtraChickenSet(userId, extraChickens)
        processedCount += hensCreated
        console.log(
          `[EXTRA_CHICKEN_EVENTS] Created ${hensCreated} new hens for user ${userId}`,
        )
      } catch {
        // console.error(`Error processing event for user ${userId}:`, error)
      }
    }

    // Update the last processed block
    await prismaClient.extraChickenProcessedBlock.update({
      where: {
        id: lastProcessedBlock.id,
      },
      data: {
        blockNumber: currentBlock,
      },
    })

    console.log(
      `[EXTRA_CHICKEN_EVENTS] Updated last processed block to ${currentBlock}`,
    )

    console.log(
      `[EXTRA_CHICKEN_EVENTS] 🎉 Processed ${logs.length} events, created ${processedCount} new hens`,
    )

    return {
      eventsProcessed: logs.length,
      hensCreated: processedCount,
    }
  } catch (error) {
    console.error(`Error checking for missed events:`, error)
    throw error
  }
}
