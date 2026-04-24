import { TransactionType } from '@prisma/client'
import env from './env'
import ignoredBurnTx from './ignoredBurnTx'
import prisma from './prismaClient'
import reportToDiscord from './reportToDiscord'
import { publicClient } from './wallet'

import eggsContractAbi from 'helpers/eggsContractAbi'

export default async function proccessJackpotWinners(
  winnersSerialIds: number[],
) {
  await prisma.$transaction(
    async ($tx) => {
      const jackpots = await publicClient.getContractEvents({
        abi: eggsContractAbi,
        address: env.EGGS_CONTRACT_ADDRESS,
        eventName: 'JackpotWinnersSet',
        fromBlock: 27597199n,
        strict: true,
      })

      const currentJackpotBlock = jackpots[jackpots.length - 1]
      const lastJackpotBlock = jackpots[jackpots.length - 2]

      const totalBurnt = await $tx.burnEvent.aggregate({
        _sum: {
          tokenAmount: true,
        },
        where: {
          blockNumber: {
            lte: currentJackpotBlock.blockNumber,
            gte: lastJackpotBlock.blockNumber,
          },
          txHash: {
            notIn: ignoredBurnTx,
          },
        },
      })

      if (!totalBurnt._sum.tokenAmount) {
        throw new Error('No tokens burnt')
      }

      const jackpotAmount = totalBurnt._sum.tokenAmount / 8

      const tierDistribution = [
        { tier: 1, winners: 1, percentage: 25 },
        { tier: 2, winners: 2, percentage: 20 },
        { tier: 3, winners: 3, percentage: 18 },
        { tier: 4, winners: 5, percentage: 15 },
        { tier: 5, winners: 10, percentage: 12 },
        { tier: 6, winners: 10, percentage: 10 },
      ]

      let currentIndex = 0
      const distributionResults = [] as {
        winnerId: number
        tier: number
        eggAmount: number
      }[]

      const winnersMap = new Map<number, { eggs: number }>()

      for (const tierInfo of tierDistribution) {
        const { tier, winners, percentage } = tierInfo

        const tierTotalEggAmount = (jackpotAmount * percentage) / 100

        const eggAmountPerWinner = Number(
          (tierTotalEggAmount / winners).toFixed(3),
        )

        for (
          let i = 0;
          i < winners && currentIndex < winnersSerialIds.length;
          i++, currentIndex++
        ) {
          const winnerId = winnersSerialIds[currentIndex]

          distributionResults.push({
            winnerId,
            tier,
            eggAmount: eggAmountPerWinner,
          })

          const user = await $tx.user.findUnique({
            where: { serialId: winnerId },
          })

          if (!user) throw new Error('[JACKPOT] User not found')

          await $tx.eggTransaction.create({
            data: {
              userId: user.id,
              amount: eggAmountPerWinner,
              type: TransactionType.JACKPOT_REWARD,
            },
          })

          await $tx.user.update({
            where: { id: user.id },
            data: {
              unclaimedEggs: {
                increment: eggAmountPerWinner,
              },
            },
          })

          winnersMap.set(winnerId, {
            eggs: eggAmountPerWinner,
          })

          console.log(
            `[JACKPOT] Distributed ${eggAmountPerWinner} EGGS to winner ${winnerId} in tier ${tier}`,
          )
        }
      }

      const displayJackpotAmount = Number(jackpotAmount.toFixed(3))
      console.log(`[JACKPOT] Total EGGS amount: ${displayJackpotAmount}`)
      console.log(
        `[JACKPOT] Total winners processed: ${distributionResults.length}`,
      )

      const tierWinners = new Map<
        number,
        { users: string[]; eggAmount: number }
      >()

      for (const result of distributionResults) {
        const { winnerId, tier, eggAmount } = result

        const user = await $tx.user.findUnique({
          where: { serialId: winnerId },
          include: { verifications: { where: { type: 'FARCASTER' } } },
        })

        if (!user) continue

        if (!tierWinners.has(tier)) {
          tierWinners.set(tier, { users: [], eggAmount })
        }

        const username = user.username || `User${winnerId}`
        tierWinners
          .get(tier)
          ?.users.push(`[@${username}](https://warpcast.com/${username})`)
      }

      const messages = []

      if (tierWinners.has(1) && tierWinners.get(1)?.users.length === 1) {
        const user = tierWinners.get(1)?.users[0]
        const eggAmount = tierWinners.get(1)?.eggAmount
        messages.push(
          `🏆 **Jackpot winner!** 🏆\nUser ${user} won ${eggAmount} $EGGS!`,
        )
      }

      for (let tier = 1; tier <= 6; tier++) {
        if (
          !tierWinners.has(tier) ||
          (tier === 1 && tierWinners.get(1)?.users.length === 1)
        )
          continue

        const users = tierWinners.get(tier)?.users
        const eggAmount = tierWinners.get(tier)?.eggAmount

        if (users && users.length > 0) {
          const userList = users.join(', ')
          messages.push(
            `💰 **Tier ${tier} winners!** 💰\nUsers ${userList} won ${eggAmount} $EGGS each!`,
          )
        }
      }

      const totalEggsDistributed = Number(
        distributionResults
          .reduce((acc, result) => acc + result.eggAmount, 0)
          .toFixed(3),
      )

      const totalBurntRounded = Number(totalBurnt._sum.tokenAmount.toFixed(3))

      messages.push(
        `🎉 **TOTAL DISTRIBUTED:** ${totalEggsDistributed} EGGS 🎉\n\n**Total Burnt:** ${totalBurntRounded} EGGS`,
      )

      const discordMessage = messages.join('\n\n')

      await reportToDiscord(discordMessage)

      return distributionResults
    },
    {
      isolationLevel: 'Serializable',
      timeout: 30_000,
    },
  )
}
