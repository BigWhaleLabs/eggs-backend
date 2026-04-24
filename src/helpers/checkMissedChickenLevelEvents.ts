import { JackpotTicketType } from '@prisma/client'
import { JACKPOT_TICKETS_FOR_UPGRADE_ATTEMPT } from './consts'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import { giveJackpotTickets } from './giveJackpotTickets'
import prismaClient from './prismaClient'
import { levelToChickenInfo } from './startChickenLevelUpgradeListener'
import verifyReferral from './verifyReferral'
import { publicClient } from './wallet'

export default async function checkMissedChickenLevelEvents() {
  try {
    const currentBlock = await publicClient.getBlockNumber()

    // Get the last processed block from database
    let lastProcessedBlock =
      await prismaClient.chickenLevelProcessedBlock.findFirst()

    if (!lastProcessedBlock) {
      // If no record exists, start from block 27597199
      const startBlock = 27597199n
      lastProcessedBlock = await prismaClient.chickenLevelProcessedBlock.create(
        {
          data: {
            blockNumber: startBlock,
          },
        },
      )
      console.log(
        `[CHICKEN_LEVEL_EVENTS] Initialized last processed block to ${startBlock}`,
      )
    }

    const START_BLOCK = lastProcessedBlock.blockNumber + 1n
    const BATCH_SIZE = 100_000n

    let successProcessed = 0
    let failureProcessed = 0
    let jackpotTicketsCreated = 0
    const commitmentsChecked = 0
    let batchCount = 0
    let skippedAsProcessed = 0

    // Skip if we're already caught up
    if (START_BLOCK > currentBlock) {
      console.log(
        `[CHICKEN_LEVEL_EVENTS] Already caught up to block ${currentBlock}, no events to process`,
      )
      return {
        successProcessed: 0,
        failureProcessed: 0,
        jackpotTicketsCreated: 0,
        commitmentsChecked: 0,
      }
    }

    const totalBlocks = currentBlock - START_BLOCK
    console.log(
      `[CHICKEN_LEVEL_EVENTS] 🚀 Starting chicken level events check - scanning from block ${START_BLOCK} to ${currentBlock} (${totalBlocks} blocks) in batches of ${BATCH_SIZE}`,
    )

    let startBlock = START_BLOCK
    while (startBlock < currentBlock) {
      const endBlock =
        startBlock + BATCH_SIZE > currentBlock
          ? currentBlock
          : startBlock + BATCH_SIZE
      batchCount++

      const progress = Number(((startBlock - START_BLOCK) * 100n) / totalBlocks)
      console.log(
        `[CHICKEN_LEVEL_EVENTS] 📦 Batch ${batchCount}: Checking blocks ${startBlock} to ${endBlock}... (${progress}% complete)`,
      )

      const startTime = Date.now()
      const [successLogs, failureLogs] = await Promise.all([
        publicClient.getContractEvents({
          address: env.EGGS_CONTRACT_ADDRESS,
          abi: eggsContractAbi,
          eventName: 'ChickenLevelSet',
          fromBlock: startBlock,
          toBlock: endBlock,
        }),
        publicClient.getContractEvents({
          address: env.EGGS_CONTRACT_ADDRESS,
          abi: eggsContractAbi,
          eventName: 'ChickenLevelSetFailed',
          fromBlock: startBlock,
          toBlock: endBlock,
        }),
      ])

      const fetchTime = Date.now() - startTime
      console.log(
        `[CHICKEN_LEVEL_EVENTS] 📊 Batch ${batchCount}: Found ${successLogs.length} success + ${failureLogs.length} failure events (fetched in ${fetchTime}ms)`,
      )

      for (const log of successLogs) {
        const { transactionHash } = log
        try {
          const alreadyProcessed =
            await prismaClient.chickenLevelUpgrade.findUnique({
              where: { transactionHash },
            })

          if (alreadyProcessed) {
            skippedAsProcessed++
            continue
          }

          const chickenId = Number(log.args.chickenId)
          const newOnChainLevel = Number(log.args.chickenLevel)

          const dbFromLevel = newOnChainLevel
          const dbToLevel = newOnChainLevel + 1

          const newYield = levelToChickenInfo[newOnChainLevel]?.dailyYield

          const hen = await prismaClient.hen.findFirst({
            where: { serialId: chickenId },
            include: { user: { include: { verifications: true } } },
          })

          if (!hen) {
            console.warn(
              `[Success] Could not find hen with serialId ${chickenId} for tx ${transactionHash}`,
            )
            continue
          }

          console.log(
            `[CHICKEN_LEVEL_EVENTS] 🐔 Processing SUCCESS event for chicken ${chickenId} (tx: ${transactionHash})`,
          )

          await prismaClient.$transaction(async (tx) => {
            // Update Hen Level in the database to the CORRECT new database level
            await tx.hen.update({
              where: { id: hen.id },
              data: { level: dbToLevel, dailyYield: newYield },
            })

            await giveJackpotTickets(
              tx,
              JACKPOT_TICKETS_FOR_UPGRADE_ATTEMPT,
              hen.userId,
              JackpotTicketType.UPGRADE,
            )

            if (!hen.user.isVerifiedBot && hen.user.verifications.length > 0) {
              await verifyReferral({
                fid: hen.user.verifications[0]?.subjectId,
              })
            }

            // Create the record with the CORRECT database levels
            await tx.chickenLevelUpgrade.create({
              data: {
                henId: hen.id,
                fromLevel: dbFromLevel,
                toLevel: dbToLevel,
                result: 1, // 1 for success
                used: true,
                transactionHash,
              },
            })
          })

          jackpotTicketsCreated += JACKPOT_TICKETS_FOR_UPGRADE_ATTEMPT
          successProcessed++
        } catch (err) {
          console.error(
            `❌ Error processing SUCCESS event for chicken (tx: ${transactionHash}):`,
            err,
          )
        }
      }

      for (const log of failureLogs) {
        const { transactionHash } = log
        try {
          const alreadyProcessed =
            await prismaClient.chickenLevelUpgrade.findUnique({
              where: { transactionHash },
            })

          if (alreadyProcessed) {
            skippedAsProcessed++
            continue
          }

          const chickenId = Number(log.args.chickenId)
          const failedFromOnChainLevel = Number(log.args.chickenLevel)

          const dbFromLevel = failedFromOnChainLevel + 1
          const dbToLevel = dbFromLevel + 1

          const hen = await prismaClient.hen.findFirst({
            where: { serialId: chickenId },
          })

          if (!hen) {
            console.warn(
              `[Failure] Could not find hen with serialId ${chickenId} for tx ${transactionHash}`,
            )
            continue
          }

          console.log(
            `[CHICKEN_LEVEL_EVENTS] 💥 Processing FAILURE event for chicken ${chickenId} (tx: ${transactionHash})`,
          )

          await prismaClient.$transaction(async (tx) => {
            await giveJackpotTickets(
              tx,
              JACKPOT_TICKETS_FOR_UPGRADE_ATTEMPT,
              hen.userId,
              JackpotTicketType.UPGRADE,
            )

            // Create the record with the CORRECT database levels
            await tx.chickenLevelUpgrade.create({
              data: {
                henId: hen.id,
                fromLevel: dbFromLevel,
                toLevel: dbToLevel,
                result: 0, // 0 for failure
                used: true,
                transactionHash,
              },
            })
          })

          jackpotTicketsCreated += JACKPOT_TICKETS_FOR_UPGRADE_ATTEMPT
          failureProcessed++
        } catch (err) {
          console.error(
            `❌ Error processing FAILURE event for chicken (tx: ${transactionHash}):`,
            err,
          )
        }
      }

      const processTime = Date.now() - startTime
      console.log(
        `[CHICKEN_LEVEL_EVENTS] ✅ Batch ${batchCount} complete in ${processTime}ms. Skipped ${skippedAsProcessed} already-processed events.`,
      )

      startBlock = endBlock + 1n
    }

    // Update the last processed block
    await prismaClient.chickenLevelProcessedBlock.update({
      where: {
        id: lastProcessedBlock.id,
      },
      data: {
        blockNumber: currentBlock,
      },
    })

    console.log(
      `[CHICKEN_LEVEL_EVENTS] Updated last processed block to ${currentBlock}`,
    )

    // console.log(
    //   `[CHICKEN_LEVEL_EVENTS] 🔍 Checking for in-flight commitments for hens with level < 5...`,
    // )
    // const allHens = await prismaClient.hen.findMany({
    //   where: { level: { lt: 5 } },
    // })

    // console.log(
    //   `[CHICKEN_LEVEL_EVENTS] 📊 Found ${allHens.length} hens to check for commitments`,
    // )

    // let commitmentsFound = 0
    // let commitmentsAlreadyProcessed = 0

    // for (const hen of allHens) {
    //   try {
    //     const hasCommitment = await publicClient.readContract({
    //       address: env.EGGS_CONTRACT_ADDRESS,
    //       abi: eggsContractAbi,
    //       functionName: 'chickenLevelCommitments',
    //       args: [BigInt(hen.serialId)],
    //     })

    //     if (hasCommitment) {
    //       commitmentsFound++
    //       const existingUpgrade =
    //         await prismaClient.chickenLevelUpgrade.findFirst({
    //           where: { henId: hen.id, fromLevel: hen.level, used: false }, // Made this more specific
    //         })

    //       if (!existingUpgrade) {
    //         const successChanceByLevel = {
    //           1: 0.9,
    //           2: 0.6,
    //           3: 0.3,
    //           4: 0.1,
    //         } as Record<number, number>

    //         const successChance = successChanceByLevel[hen.level]
    //         if (!successChance) throw new Error(`Invalid level: ${hen.level}`)

    //         const success = Math.random() < successChance
    //         const result = success ? 1 : 0

    //         await prismaClient.chickenLevelUpgrade.create({
    //           data: {
    //             henId: hen.id,
    //             fromLevel: hen.level,
    //             toLevel: hen.level + 1,
    //             result,
    //             used: false,
    //           },
    //         })

    //         commitmentsChecked++
    //       } else {
    //         commitmentsAlreadyProcessed++
    //       }
    //     }
    //   } catch (err) {
    //     console.error(`❌ Error checking commitment for hen ${hen.id}:`, err)
    //   }
    // }

    // console.log(
    //   `[CHICKEN_LEVEL_EVENTS] ✅ Commitment check complete: ${commitmentsFound} commitments found, ${commitmentsChecked} new records created, ${commitmentsAlreadyProcessed} already had a record`,
    // )

    console.log(
      `[CHICKEN_LEVEL_EVENTS] 🎉 FINAL SUMMARY:\n` +
        `  📦 Batches processed: ${batchCount}\n` +
        `  ✅ Success events processed: ${successProcessed}\n` +
        `  ❌ Failure events processed: ${failureProcessed}\n` +
        `  ⏭️  Skipped (already processed): ${skippedAsProcessed}\n` +
        `  🎫 Jackpot tickets created: ${jackpotTicketsCreated}\n` +
        `  🎲 Commitments handled: ${commitmentsChecked}`,
    )

    return {
      successProcessed,
      failureProcessed,
      jackpotTicketsCreated,
      commitmentsChecked,
    }
  } catch (error) {
    console.error(
      `Fatal error checking for missed chicken level events:`,
      error,
    )
    throw error
  }
}
