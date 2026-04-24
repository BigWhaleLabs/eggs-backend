import { formatUnits, zeroAddress } from 'viem'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import prismaClient from './prismaClient'
import { publicClient } from './wallet'

const DEPLOYMENT_BLOCK = 27597199n

async function processBurnEvent(
  from: string,
  to: string,
  value: bigint,
  blockNumber: bigint,
  transactionHash: string,
  blockTimestamp: bigint,
) {
  try {
    const tokenAmount = parseFloat(formatUnits(value, 18))

    await prismaClient.burnEvent.create({
      data: {
        txHash: transactionHash,
        blockNumber,
        tokenAmount,
        burner: from,
        timestamp: new Date(Number(blockTimestamp) * 1000),
      },
    })

    console.log(
      `[BURN] Recorded burn event: ${tokenAmount} tokens from ${from}`,
    )
  } catch (error) {
    console.error('[BURN] Error processing burn event:', error)
  }
}

export async function checkMissedBurnEvents() {
  console.log('[BURN] Checking for missed burn events')

  try {
    const latestEvent = await prismaClient.burnEvent.findFirst({
      orderBy: {
        blockNumber: 'desc',
      },
    })

    const latestBlock = await publicClient.getBlockNumber()

    let fromBlock = latestEvent
      ? latestEvent.blockNumber + 1n
      : DEPLOYMENT_BLOCK

    const BATCH_SIZE = 10000n

    console.log(
      `[BURN] Processing burn events from block ${fromBlock} to ${latestBlock}`,
    )

    while (fromBlock <= latestBlock) {
      const toBlock =
        fromBlock + BATCH_SIZE - 1n > latestBlock
          ? latestBlock
          : fromBlock + BATCH_SIZE - 1n

      console.log(`[BURN] Processing batch: ${fromBlock} to ${toBlock}`)

      const logs = await publicClient.getContractEvents({
        address: env.EGGS_CONTRACT_ADDRESS,
        abi: eggsContractAbi,
        eventName: 'Transfer',
        fromBlock,
        toBlock,
        strict: true,
        args: {
          to: zeroAddress,
        },
      })

      console.log(
        `[BURN] Found ${logs.length} burn events in blocks ${fromBlock}-${toBlock}`,
      )

      if (logs.length > 0) {
        const blockCache = new Map()

        for (const log of logs) {
          const { from, to, value } = log.args

          let blockTimestamp
          if (blockCache.has(log.blockNumber.toString())) {
            blockTimestamp = blockCache.get(log.blockNumber.toString())
          } else {
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber,
            })
            blockTimestamp = block.timestamp
            blockCache.set(log.blockNumber.toString(), blockTimestamp)
          }

          await processBurnEvent(
            from,
            to,
            value,
            log.blockNumber,
            log.transactionHash,
            blockTimestamp,
          )
        }
      }

      // Move to next batch
      fromBlock = toBlock + 1n
    }

    console.log('[BURN] Completed processing all missed burn events')
  } catch (error) {
    console.error('[BURN] Error checking missed burn events:', error)
  }
}

export async function startBurnEventListener() {
  console.log('[BURN] Starting burn event listener')

  try {
    publicClient.watchContractEvent({
      address: env.EGGS_CONTRACT_ADDRESS,
      abi: eggsContractAbi,
      eventName: 'Transfer',
      strict: true,
      args: {
        to: zeroAddress,
      },
      onLogs: async (logs) => {
        console.log(`[BURN] Received ${logs.length} burn events`)

        for (const log of logs) {
          const { from, to, value } = log.args

          const block = await publicClient.getBlock({
            blockNumber: log.blockNumber,
          })

          await processBurnEvent(
            from,
            to,
            value,
            log.blockNumber,
            log.transactionHash,
            block.timestamp,
          )
        }
      },
      onError: (error) => {
        console.error('[BURN] Error in burn event listener:', error)
        // Filter errors are common with RPC providers, just log them
        if (error.message?.includes('filter not found')) {
          console.log(
            '[BURN] Filter error detected - this is normal, listener will auto-recover',
          )
        }
      },
    })

    console.log('[BURN] Burn event listener started successfully')
  } catch (error) {
    console.error('[BURN] Error starting burn event listener:', error)
  }
}

export default async function setupBurnEventTracking() {
  try {
    await checkMissedBurnEvents()
    await startBurnEventListener()
    console.log('[BURN] Burn event tracking setup complete')
  } catch (error) {
    console.error('[BURN] Failed to setup burn event tracking:', error)
  }
}
