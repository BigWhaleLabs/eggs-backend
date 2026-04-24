import { JackpotTicketType } from '@prisma/client'
import { formatUnits, isAddress } from 'viem'
import { JACKPOT_TICKETS_FOR_CLAIM_STREAK } from './consts'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import getClaimPeriodDates from './getClaimPeriodDates'
import getClaimStreak from './getClaimStreak'
import getConnectedWalletsByFID from './getConnectedWalletsByFID'
import getEligibleUsers from './getEligibleUsers'
import { giveJackpotTickets } from './giveJackpotTickets'
import { openJackpotClaims } from './openJackpotClaims'
import prismaClient from './prismaClient'
import reportToDiscord from './reportToDiscord'
import { publicClient } from './wallet'

export default async function distributeHoldingsTickets() {
  console.log('[JACKPOT_SNAPSHOT] Distributing tickets...')

  // Get eligible users (have claimed eggs or 3+ hens) with connected wallets
  const users = await getEligibleUsers()

  console.log(`[JACKPOT_SNAPSHOT] Found ${users.length} eligible users...`)

  // HOLDINGS DISTRIBUTION LOOP
  console.log('[JACKPOT_SNAPSHOT] Starting holdings tickets distribution...')
  const batchSize = 10
  for (let i = 0; i < users.length; i += batchSize) {
    console.log(
      `Processing holdings for users ${i} to ${i + batchSize}/${users.length}...`,
    )
    const userBatch = users.slice(i, i + batchSize)

    await Promise.all(
      userBatch.map(async (user) => {
        try {
          const farcasterVerification = user.verifications.find(
            (verification) => verification.type === 'FARCASTER',
          )

          if (!farcasterVerification?.subjectId) return

          const connectedAddresses = (
            await getConnectedWalletsByFID(
              Number(farcasterVerification.subjectId),
            )
          ).filter((address) =>
            isAddress(address, {
              strict: true,
            }),
          )

          if (!connectedAddresses.length) return

          const uniqueAddresses = [...new Set(connectedAddresses)]
          let currentEggsHoldings = 0n
          console.log(
            `Found ${uniqueAddresses.length} unique addresses for user ${user.id}`,
          )

          for (const address of uniqueAddresses) {
            // Get both wallet balance and staked amount
            const [balance, staked] = await Promise.all([
              publicClient.readContract({
                abi: eggsContractAbi,
                functionName: 'balanceOf',
                args: [address as `0x${string}`],
                address: env.EGGS_CONTRACT_ADDRESS,
              }),
              publicClient.readContract({
                abi: eggsContractAbi,
                functionName: 'stakeOf',
                args: [address as `0x${string}`],
                address: env.EGGS_CONTRACT_ADDRESS,
              }),
            ])

            currentEggsHoldings += balance + staked
          }

          const totalHoldingTickets = Math.floor(
            parseFloat(formatUnits(currentEggsHoldings, 18)) / 1000,
          )

          if (totalHoldingTickets > 0) {
            // Check if holding tickets were already given for this period
            const { specialTicketsStart, specialTicketsEnd } =
              getClaimPeriodDates()

            const existingHoldingTickets =
              await prismaClient.jackpotTicket.findFirst({
                where: {
                  userId: user.id,
                  type: JackpotTicketType.HOLD,
                  createdAt: {
                    gte: specialTicketsStart,
                    lt: specialTicketsEnd,
                  },
                },
              })

            if (!existingHoldingTickets) {
              await giveJackpotTickets(
                prismaClient,
                totalHoldingTickets,
                user.id,
                JackpotTicketType.HOLD,
              )
            }
          }
        } catch (e) {
          console.error(
            `Error distributing holding tickets for user ${user.id}: ${e}`,
          )
        }
      }),
    )
  }

  await reportToDiscord(`🎟️ Holdings tickets distribution completed!`)

  // STREAK DISTRIBUTION LOOP
  console.log('[JACKPOT_SNAPSHOT] Starting streak tickets distribution...')
  for (let i = 0; i < users.length; i += batchSize) {
    console.log(
      `Processing streaks for users ${i} to ${i + batchSize}/${users.length}...`,
    )
    const userBatch = users.slice(i, i + batchSize)

    await Promise.all(
      userBatch.map(async (user) => {
        try {
          const streak = await getClaimStreak(user.id, prismaClient)

          if (streak.claimNumber >= 7) {
            const { specialTicketsStart, specialTicketsEnd } =
              getClaimPeriodDates()

            const existingTickets = await prismaClient.jackpotTicket.findFirst({
              where: {
                userId: user.id,
                type: JackpotTicketType.CLAIM_STREAK,
                createdAt: {
                  gte: specialTicketsStart,
                  lt: specialTicketsEnd,
                },
              },
            })

            if (!existingTickets) {
              await giveJackpotTickets(
                prismaClient,
                JACKPOT_TICKETS_FOR_CLAIM_STREAK,
                user.id,
                JackpotTicketType.CLAIM_STREAK,
              )
              console.log(
                `Awarded ${JACKPOT_TICKETS_FOR_CLAIM_STREAK} streak tickets to user ${user.id} for 7-day claim streak`,
              )
            }
          }
        } catch (e) {
          console.error(
            `Error distributing streak tickets for user ${user.id}: ${e}`,
          )
        }
      }),
    )
  }

  await reportToDiscord(`🎟️ Streak tickets distribution completed!`)

  // OPEN JACKPOT CLAIMS
  await openJackpotClaims()
  await reportToDiscord(`🎟️ Opened jackpot claims!`)
}
