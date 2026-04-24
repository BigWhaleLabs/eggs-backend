import { JackpotTicketType, TransactionType } from '@prisma/client'
import { JACKPOT_TICKETS_FOR_UPGRADE_ATTEMPT } from './consts'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import { giveJackpotTickets } from './giveJackpotTickets'
import prismaClient from './prismaClient'
import verifyReferral from './verifyReferral'
import { publicClient } from './wallet'

export const levelToChickenInfo = [
  { price: 0, successRate: 100, dailyYield: 1 },
  {
    price: 250,
    successRate: 90,
    dailyYield: 10,
  },
  { price: 1250, successRate: 60, dailyYield: 25 },
  { price: 5000, successRate: 30, dailyYield: 75 },
  { price: 20000, successRate: 10, dailyYield: 250 },
] as const

export async function startChickenLevelEventListener() {
  console.log('[SETUP] Starting robust chicken level event listener...')

  publicClient.watchContractEvent({
    strict: true,
    address: env.EGGS_CONTRACT_ADDRESS,
    abi: eggsContractAbi,
    eventName: 'ChickenLevelSet',
    onLogs: async (logs) => {
      for (const log of logs) {
        const { transactionHash } = log
        try {
          const alreadyProcessed =
            await prismaClient.chickenLevelUpgrade.findUnique({
              where: { transactionHash },
            })

          if (alreadyProcessed) {
            console.log(
              `[EVENT] Skipping already processed success tx: ${transactionHash}`,
            )
            continue
          }

          const chickenId = Number(log.args.chickenId)
          const newOnChainLevel = Number(log.args.chickenLevel)

          const dbFromLevel = newOnChainLevel
          const dbToLevel = newOnChainLevel + 1
          const result = 1

          const hen = await prismaClient.hen.findFirst({
            where: { serialId: chickenId },
            include: { user: { include: { verifications: true } } },
          })

          if (!hen) {
            console.error(
              `[EVENT] Could not find hen with serialId ${chickenId} for tx: ${transactionHash}`,
            )
            continue
          }

          console.log(
            `[EVENT] 🐔 Processing SUCCESS event for chicken ${chickenId} (tx: ${transactionHash})`,
          )

          await prismaClient.$transaction(async (tx) => {
            const updatedRecords = await tx.chickenLevelUpgrade.updateMany({
              where: {
                henId: hen.id,
                fromLevel: dbFromLevel,
                toLevel: dbToLevel,
                result: result,
                used: false,
              },
              data: { used: true, transactionHash },
            })

            if (updatedRecords.count === 0) {
              await tx.chickenLevelUpgrade.create({
                data: {
                  henId: hen.id,
                  fromLevel: dbFromLevel,
                  toLevel: dbToLevel,
                  result: result,
                  used: true,
                  transactionHash,
                },
              })
            }

            await giveJackpotTickets(
              tx,
              JACKPOT_TICKETS_FOR_UPGRADE_ATTEMPT,
              hen.userId,
              JackpotTicketType.UPGRADE,
            )

            const newYield = levelToChickenInfo[newOnChainLevel].dailyYield
            await tx.hen.update({
              where: { id: hen.id },
              data: { level: dbToLevel, dailyYield: newYield },
            })

            await tx.eggTransaction.create({
              data: {
                userId: hen.userId,
                amount: -1,
                type: TransactionType.UPGRADE_COST,
                henId: hen.id,
              },
            })

            if (!hen.user.isVerifiedBot && hen.user.verifications.length > 0) {
              await verifyReferral({
                fid: hen.user.verifications[0]?.subjectId,
              })
            }
          })
        } catch (error) {
          console.error(
            `[EVENT] Error processing ChickenLevelSet event for tx ${transactionHash}:`,
            error,
          )
        }
      }
    },
  })

  publicClient.watchContractEvent({
    strict: true,
    address: env.EGGS_CONTRACT_ADDRESS,
    abi: eggsContractAbi,
    eventName: 'ChickenLevelSetFailed',
    onLogs: async (logs) => {
      for (const log of logs) {
        const { transactionHash } = log
        try {
          const alreadyProcessed =
            await prismaClient.chickenLevelUpgrade.findUnique({
              where: { transactionHash },
            })

          if (alreadyProcessed) {
            console.log(
              `[EVENT] Skipping already processed failure tx: ${transactionHash}`,
            )
            continue
          }

          const chickenId = Number(log.args.chickenId)
          const failedFromOnChainLevel = Number(log.args.chickenLevel)

          const dbFromLevel = failedFromOnChainLevel + 1
          const dbToLevel = dbFromLevel + 1
          const result = 0 // Failure

          const hen = await prismaClient.hen.findFirst({
            where: { serialId: chickenId },
          })

          if (!hen) {
            console.error(
              `[EVENT] Could not find hen with serialId ${chickenId} for tx: ${transactionHash}`,
            )
            continue
          }

          console.log(
            `[EVENT] 💥 Processing FAILED upgrade for chicken ${chickenId} (tx: ${transactionHash})`,
          )

          await prismaClient.$transaction(async (tx) => {
            const updatedRecords = await tx.chickenLevelUpgrade.updateMany({
              where: {
                henId: hen.id,
                fromLevel: dbFromLevel,
                toLevel: dbToLevel,
                result: result,
                used: false,
              },
              data: { used: true, transactionHash },
            })

            if (updatedRecords.count === 0) {
              await tx.chickenLevelUpgrade.create({
                data: {
                  henId: hen.id,
                  fromLevel: dbFromLevel,
                  toLevel: dbToLevel,
                  result: result,
                  used: true,
                  transactionHash,
                },
              })
            }

            await giveJackpotTickets(
              tx,
              JACKPOT_TICKETS_FOR_UPGRADE_ATTEMPT,
              hen.userId,
              JackpotTicketType.UPGRADE,
            )

            await tx.eggTransaction.create({
              data: {
                userId: hen.userId,
                amount: -1,
                type: TransactionType.UPGRADE_FAIL,
                henId: hen.id,
              },
            })
          })
        } catch (error) {
          console.error(
            `[EVENT] Error processing ChickenLevelSetFailed event for tx ${transactionHash}:`,
            error,
          )
        }
      }
    },
  })

  console.log('[SETUP] Chicken level event listener started successfully.')
}
