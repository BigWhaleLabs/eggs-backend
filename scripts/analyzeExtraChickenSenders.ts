import { writeFile } from 'fs/promises'
import eggsContractAbi from '../src/helpers/eggsContractAbi'
import env from '../src/helpers/env'
import { publicClient } from '../src/helpers/wallet'

const START_BLOCK = 27597199n
const BATCH_SIZE = 50_000n

interface SenderStats {
  [address: string]: number
}

async function analyzeExtraChickenSenders() {
  try {
    console.log(
      '[ANALYZE] Starting analysis of ExtraChickensSet event senders...',
    )

    const currentBlock = await publicClient.getBlockNumber()
    console.log(`[ANALYZE] Current block: ${currentBlock}`)

    let fromBlock = START_BLOCK
    let totalEventsProcessed = 0
    const senderStats: SenderStats = {}

    // Process blocks in batches
    while (fromBlock <= currentBlock) {
      const toBlock =
        fromBlock + BATCH_SIZE - 1n > currentBlock
          ? currentBlock
          : fromBlock + BATCH_SIZE - 1n

      console.log(`[ANALYZE] Processing blocks ${fromBlock} to ${toBlock}...`)

      const logs = await publicClient.getContractEvents({
        address: env.EGGS_CONTRACT_ADDRESS,
        abi: eggsContractAbi,
        eventName: 'ExtraChickensSet',
        fromBlock,
        toBlock,
      })

      console.log(
        `[ANALYZE] Found ${logs.length} ExtraChickensSet events in this batch`,
      )

      // Process logs in batches of 10 in parallel
      const PARALLEL_BATCH_SIZE = 10
      for (let i = 0; i < logs.length; i += PARALLEL_BATCH_SIZE) {
        const logBatch = logs.slice(i, i + PARALLEL_BATCH_SIZE)

        const results = await Promise.allSettled(
          logBatch.map(async (log) => {
            const transaction = await publicClient.getTransaction({
              hash: log.transactionHash,
            })
            return transaction.from.toLowerCase()
          }),
        )

        // Process results
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const senderAddress = result.value

            // Increment the count for this sender
            if (senderStats[senderAddress]) {
              senderStats[senderAddress]++
            } else {
              senderStats[senderAddress] = 1
            }

            totalEventsProcessed++
          } else {
            console.error(
              `[ANALYZE] Error processing transaction:`,
              result.reason,
            )
          }
        }

        console.log(
          `[ANALYZE] Processed ${Math.min(i + PARALLEL_BATCH_SIZE, logs.length)}/${logs.length} logs in current block range`,
        )
      }

      console.log(
        `[ANALYZE] Batch complete. Total events processed: ${totalEventsProcessed}`,
      )

      // Move to next batch
      fromBlock = toBlock + 1n
    }

    // Sort by count descending
    const sortedStats = Object.entries(senderStats)
      .sort(([, a], [, b]) => b - a)
      .reduce((acc, [address, count]) => {
        acc[address] = count
        return acc
      }, {} as SenderStats)

    console.log(
      `[ANALYZE] Analysis complete! Total events: ${totalEventsProcessed}, Unique senders: ${Object.keys(senderStats).length}`,
    )

    // Write results to JSON file
    const outputPath = 'extra-chicken-senders.json'
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          metadata: {
            startBlock: START_BLOCK.toString(),
            endBlock: currentBlock.toString(),
            totalEvents: totalEventsProcessed,
            uniqueSenders: Object.keys(senderStats).length,
            analyzedAt: new Date().toISOString(),
          },
          senders: sortedStats,
        },
        null,
        2,
      ),
    )

    console.log(`[ANALYZE] Results written to ${outputPath}`)

    // Print top 10 senders
    console.log('\n[ANALYZE] Top 10 senders:')
    Object.entries(sortedStats)
      .slice(0, 10)
      .forEach(([address, count], index) => {
        console.log(`${index + 1}. ${address}: ${count} events`)
      })

    return {
      totalEvents: totalEventsProcessed,
      uniqueSenders: Object.keys(senderStats).length,
      stats: sortedStats,
    }
  } catch (error) {
    console.error('[ANALYZE] Fatal error:', error)
    throw error
  }
}

void (async () => {
  console.log('Starting ExtraChickensSet senders analysis...')

  try {
    const result = await analyzeExtraChickenSenders()
    console.log('\nAnalysis completed successfully!')
    console.log(`Total events: ${result.totalEvents}`)
    console.log(`Unique senders: ${result.uniqueSenders}`)
    process.exit(0)
  } catch (error) {
    console.error('Analysis failed:', error)
    process.exit(1)
  }
})()
