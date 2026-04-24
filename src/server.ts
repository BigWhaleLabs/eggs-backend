import 'core-js'
import 'reflect-metadata'

import 'json-bigint-patch'

import { spawn } from 'bun'
import checkMissedChickenLevelEvents from 'helpers/checkMissedChickenLevelEvents'
import checkMissedExtraChickenEvents from 'helpers/checkMissedExtraChickenEvents'
import startChickensBurnListener from 'helpers/chickensBurnListener'
import startChickensTransferListener from 'helpers/chickensTransferListener'
import cleanupOldReplayTokens from 'helpers/cleanupOldReplayTokens'
import distributeHoldingsTickets from 'helpers/createJackpotSnapshot'
import detectBotFarms from 'helpers/detectBotFarms'
import distributeStakingRewards from 'helpers/distributeStakingRewards'
import drawJackpot from 'helpers/drawJackpot'
import eggsContractAbi from 'helpers/eggsContractAbi'
import { closeJackpotClaims } from 'helpers/openJackpotClaims'
import prismaClient from 'helpers/prismaClient'
import setupBurnEventTracking from 'helpers/proccessBurnedEggs'
import proccessExtraChickenSet from 'helpers/proccessExtraChickenSet'
import proccessJackpotWinners from 'helpers/proccessJackpotWinners'
import reportToDiscord from 'helpers/reportToDiscord'
import setStakingOpen from 'helpers/setStakingOpen'
import { startChickenLevelEventListener } from 'helpers/startChickenLevelUpgradeListener'
import { startJackpotTicketEventListener } from 'helpers/startJackpotEventListener'
import startListeningToFarcasterEvents from 'helpers/startListeningToFarcasterEvents'
import { startTicketEventListener } from 'helpers/ticketEventListener'
import tipAllocationCron from 'helpers/tipAllocationCron'
import updateConnectedWallets from 'helpers/updateConnectedWallets'
import updateFarcasterData from 'helpers/updateFarcasterData'
import { updateUnclaimedEggs } from 'helpers/updateUnclaimedEggs'
import { publicClient } from 'helpers/wallet'
import cron from 'node-cron'

const cpus = navigator.hardwareConcurrency
const buns = new Array(cpus)

console.log(`[SERVER] Starting ${cpus} buns`)

// 1. Start servers immediately - don't block on background jobs
for (let i = 0; i < cpus; i++) {
  buns[i] = spawn({
    cmd: ['bun', './src/app.ts'],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  })
}

console.log('[SERVER] All buns started')

// 2. Start background jobs asynchronously without blocking
void setupBackgroundJobs()

async function setupBackgroundJobs() {
  console.log('[SERVER] Starting background jobs...')

  // Initialize one-time setup tasks
  try {
    console.log('[SERVER] Running missed events checks...')
    await checkMissedExtraChickenEvents()
    await checkMissedChickenLevelEvents()
    console.log('[SERVER] Missed events checks completed')
  } catch (error) {
    console.error('[SERVER] Error in one-time setup:', error)
    await reportToDiscord(`Server setup error: ${error}`)
  }

  // Start recurring cron jobs with proper cron.schedule
  setupCronJobs()

  // Start blockchain event listeners (always async)
  await setupEventListeners()

  console.log('[SERVER] All background jobs initialized')
}

async function setupEventListeners() {
  console.log('[SERVER] Starting blockchain event listeners...')
  try {
    // Start Farcaster event listening
    void startListeningToFarcasterEvents()
    // All event listeners are async and run with persistent block tracking
    await startTicketEventListener()
    await startChickenLevelEventListener()
    await startJackpotTicketEventListener()
    await setupBurnEventTracking()
    await startChickensTransferListener()
    await startChickensBurnListener()

    // Start additional contract event watchers
    setupContractEventWatchers()

    console.log('[SERVER] All event listeners started')
  } catch (error) {
    console.error('[SERVER] Error starting event listeners:', error)
    await reportToDiscord(`Event listeners setup error: ${error}`)
  }
}

function setupCronJobs() {
  console.log('[SERVER] Setting up cron jobs...')

  // Daily jobs using cron.schedule at different UTC hours to spread load
  cron.schedule('30 1 * * *', () => {
    console.log(
      '[CRON] Scheduling daily connected wallets update at 1:30 AM UTC',
    )
    // Run in background without blocking
    void (async () => {
      try {
        await updateConnectedWallets()
        console.log('[CRON] Connected wallets update completed')
      } catch (error) {
        console.error('[CRON] Error updating connected wallets:', error)
        await reportToDiscord(`Connected wallets update error: ${error}`)
      }
    })()
  })

  cron.schedule('0 1 * * *', () => {
    console.log('[CRON] Scheduling bot detection at 1 AM UTC')
    // Run in background without blocking
    void (async () => {
      try {
        await detectBotFarms()
        console.log('[CRON] Bot detection completed')
      } catch (error) {
        console.error('[CRON] Error in bot detection:', error)
        await reportToDiscord(`Bot detection error: ${error}`)
      }
    })()
  })

  // Farcaster data update (daily at 8 AM PT - usernames and scores)
  cron.schedule(
    '0 8 * * *', // 8 AM PT
    () => {
      console.log(
        '[CRON] Scheduling daily Farcaster data update (usernames and scores) at 8 AM PT',
      )
      // Run in background without blocking
      void (async () => {
        try {
          const result = await updateFarcasterData()
          console.log('[CRON] Farcaster data update completed')
          console.log(
            `[CRON] Updated ${result.usernamesUpdated} usernames and ${result.scoresUpdated} scores`,
          )
        } catch (error) {
          console.error('[CRON] Error updating Farcaster data:', error)
          await reportToDiscord(`Farcaster data update error: ${error}`)
        }
      })()
    },
    {
      scheduled: true,
      timezone: 'America/Los_Angeles',
    },
  )

  // Jackpot-related jobs (Los Angeles timezone)
  cron.schedule(
    '0 14 * * 1', // Monday 2 PM PT
    () => {
      console.log('[CRON] Scheduling distributeHoldingsTickets')
      // Run in background without blocking
      void (async () => {
        try {
          await distributeHoldingsTickets()
          console.log('[CRON] distributeHoldingsTickets completed successfully')
        } catch (error) {
          console.error('[CRON] Error in distributeHoldingsTickets:', error)
          await reportToDiscord(`Holdings tickets error: ${error}`)
        }
      })()
    },
    {
      scheduled: true,
      timezone: 'America/Los_Angeles',
    },
  )

  // Staking rewards distribution and staking opening
  cron.schedule(
    '0 14 * * 2', // Tuesday 2 PM PT
    () => {
      console.log('[CRON] Scheduling staking rewards and staking open')
      // Run in background without blocking
      void (async () => {
        try {
          // First distribute staking rewards
          await distributeStakingRewards()
          await reportToDiscord('💰 Staking rewards distributed.')
          console.log('[CRON] Staking rewards distributed')

          // Then open staking for the new week
          await setStakingOpen(true)
          await reportToDiscord('🔓 Staking opened for new week.')
          console.log('[CRON] Staking opened successfully')
        } catch (error) {
          console.error('[CRON] Error in staking rewards/open:', error)
          await reportToDiscord(`Staking rewards/open error: ${error}`)
        }
      })()
    },
    {
      scheduled: true,
      timezone: 'America/Los_Angeles',
    },
  )

  cron.schedule(
    '0 14 * * 2', // Tuesday 2 PM PT
    () => {
      console.log('[CRON] Scheduling jackpot close and draw')
      // Run in background without blocking
      void (async () => {
        try {
          await closeJackpotClaims()
          await reportToDiscord('🎟️ Jackpot claims closed.')
          console.log('[CRON] Jackpot claims closed')
          await drawJackpot()
          await reportToDiscord('🎟️ Jackpot draw completed.')
          console.log('[CRON] Jackpot draw completed')
        } catch (error) {
          console.error('[CRON] Error in jackpot close/draw:', error)
          await reportToDiscord(`Jackpot error: ${error}`)
        }
      })()
    },
    {
      scheduled: true,
      timezone: 'America/Los_Angeles',
    },
  )

  // Tip allocation (runs daily at 3 PM Los Angeles time - 1 hour after jackpot)
  cron.schedule(
    '0 15 * * *',
    () => {
      console.log('[CRON] Scheduling tip allocation')
      // Run in background without blocking
      void (async () => {
        try {
          await tipAllocationCron()
          console.log('[CRON] Tip allocation completed successfully')
        } catch (error) {
          console.error('[CRON] Error in tip allocation:', error)
          await reportToDiscord(`Tip allocation error: ${error}`)
        }
      })()
    },
    {
      scheduled: true,
      timezone: 'America/Los_Angeles',
    },
  )

  // Close staking 12 hours after jackpot draw (Wednesday 2 AM PT)
  cron.schedule(
    '0 2 * * 3', // Wednesday 2 AM PT
    () => {
      console.log('[CRON] Scheduling staking close')
      // Run in background without blocking
      void (async () => {
        try {
          await setStakingOpen(false)
          await reportToDiscord('🔒 Staking closed.')
          console.log('[CRON] Staking closed successfully')
        } catch (error) {
          console.error('[CRON] Error closing staking:', error)
          await reportToDiscord(`Staking close error: ${error}`)
        }
      })()
    },
    {
      scheduled: true,
      timezone: 'America/Los_Angeles',
    },
  )

  // Hourly jobs
  cron.schedule('0 * * * *', () => {
    console.log('[CRON] Scheduling unclaimed eggs update')
    // Run in background without blocking
    void (async () => {
      try {
        await updateUnclaimedEggs()
        console.log('[CRON] Unclaimed eggs update completed')
      } catch (error) {
        console.error('[CRON] Error in unclaimed eggs update:', error)
      }
    })()
  })

  // Cleanup old replay tokens every 6 hours
  cron.schedule('0 */6 * * *', () => {
    console.log('[CRON] Scheduling replay token cleanup')
    // Run in background without blocking
    void (async () => {
      try {
        await cleanupOldReplayTokens()
        console.log('[CRON] Replay token cleanup completed')
      } catch (error) {
        console.error('[CRON] Error in replay token cleanup:', error)
      }
    })()
  })

  console.log('[SERVER] Cron jobs configured')

  // Add cron health check - verify cron is working every hour
  cron.schedule('0 * * * *', () => {
    console.log(`[CRON_HEALTH] Cron is working at ${new Date().toISOString()}`)
  })

  // Add a watchdog that logs every 30 minutes to help track server health
  setInterval(
    () => {
      console.log(`[WATCHDOG] Server is alive at ${new Date().toISOString()}`)
    },
    30 * 60 * 1000,
  ) // Every 30 minutes

  // Add database health check every hour
  setInterval(
    () => {
      void (async () => {
        try {
          await prismaClient.$queryRaw`SELECT 1`
          console.log('[DB_HEALTH] Database connection is healthy')
        } catch (error) {
          console.error('[DB_HEALTH] Database connection issue:', error)
          await reportToDiscord(`🚨 Database connection issue: ${error}`)
        }
      })()
    },
    60 * 60 * 1000,
  ) // Every hour
}

function setupContractEventWatchers() {
  console.log('[SERVER] Setting up contract event watchers...')

  // ExtraChickensSet event watcher
  publicClient.watchContractEvent({
    abi: eggsContractAbi,
    strict: true,
    eventName: 'ExtraChickensSet',
    onLogs: async (logs) => {
      for (const log of logs) {
        try {
          await proccessExtraChickenSet(
            Number(log.args.userId),
            Number(log.args.extraChickens),
          )
        } catch (error) {
          console.error('[EVENT] Error processing ExtraChickensSet:', error)
        }
      }
    },
    onError: (error) => {
      console.error('[EVENT] Error in ExtraChickensSet event listener:', error)
      if (error.message?.includes('filter not found')) {
        console.log(
          '[EVENT] Filter error in ExtraChickensSet - this is normal with RPC providers',
        )
      }
    },
  })

  // JackpotWinnersSet event watcher
  publicClient.watchContractEvent({
    strict: true,
    abi: eggsContractAbi,
    eventName: 'JackpotWinnersSet',
    onLogs: async (logs) => {
      try {
        const winnerLog = logs[0]
        await publicClient.waitForTransactionReceipt({
          hash: winnerLog.transactionHash,
          confirmations: 2,
        })
        const serialIds = winnerLog.args.winnerIds.map(Number)
        await proccessJackpotWinners(serialIds)
      } catch (error) {
        console.error('[EVENT] Error processing JackpotWinnersSet:', error)
      }
    },
    onError: (error) => {
      console.error('[EVENT] Error in JackpotWinnersSet event listener:', error)
      if (error.message?.includes('filter not found')) {
        console.log(
          '[EVENT] Filter error in JackpotWinnersSet - this is normal with RPC providers',
        )
      }
    },
  })

  console.log('[SERVER] Contract event watchers configured')
}

function kill() {
  console.log('[SERVER] Killing all buns')
  for (const bun of buns) {
    bun.kill()
  }
  void prismaClient.$disconnect()
  process.kill(process.pid, 'SIGKILL')
  process.exit()
}

process.on('SIGINT', kill)
process.on('SIGTERM', kill)
process.on('exit', kill)

// Add better error handling for unhandled rejections and exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('[PROCESS] Unhandled Rejection at:', promise, 'reason:', reason)
  // Don't exit the process, just log the error and report to Discord
  void reportToDiscord(`🚨 Unhandled Promise Rejection: ${reason}`)
})

process.on('uncaughtException', (error) => {
  console.error('[PROCESS] Uncaught Exception:', error)
  void reportToDiscord(
    `🚨 Uncaught Exception: ${error.message}\n\nStack trace:\n${error.stack}`,
  )
  // For uncaught exceptions, we should exit immediately to prevent zombie processes
  setTimeout(() => {
    console.log('[PROCESS] Force killing due to uncaught exception')
    kill()
  }, 1000)
})

// Log memory usage every hour to detect potential leaks
setInterval(
  () => {
    const memUsage = process.memoryUsage()
    console.log('[MEMORY] Memory usage:', {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
    })
  },
  60 * 60 * 1000,
) // Every hour
