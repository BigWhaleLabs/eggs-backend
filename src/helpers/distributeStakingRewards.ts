import { TransactionType } from '@prisma/client'
import { formatUnits, isAddress } from 'viem'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import getEligibleUsers from './getEligibleUsers'
import prismaClient from './prismaClient'
import reportToDiscord from './reportToDiscord'
import { publicClient } from './wallet'

export default async function distributeStakingRewards() {
  try {
    console.log(
      '[STAKING_REWARDS] 🎯 Starting weekly staking reward distribution...',
    )

    void reportToDiscord(
      '[STAKING_REWARDS] 🎯 Starting weekly staking reward distribution...',
    )

    // 1. Get total $EGGS burned in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const burnEvents = await prismaClient.burnEvent.findMany({
      where: {
        timestamp: {
          gte: sevenDaysAgo,
        },
      },
    })

    const totalBurnedLast7Days = burnEvents.reduce(
      (sum, event) => sum + event.tokenAmount,
      0,
    )

    console.log(
      `[STAKING_REWARDS] 🔥 Total $EGGS burned in last 7 days: ${totalBurnedLast7Days}`,
    )

    // 2. Calculate 12.5% of burned tokens for staking rewards
    const totalStakingRewards = totalBurnedLast7Days * 0.25

    console.log(
      `[STAKING_REWARDS] 💰 Total staking rewards to distribute: ${totalStakingRewards}`,
    )

    if (totalStakingRewards === 0) {
      console.log('[STAKING_REWARDS] ⚠️  No staking rewards to distribute')
      return {
        totalBurned: totalBurnedLast7Days,
        totalRewards: totalStakingRewards,
        usersRewarded: 0,
      }
    }

    // 3. Find all eligible users with connected wallets (have claimed eggs or 3+ hens)
    const usersWithWallets = await getEligibleUsers()

    console.log(
      `[STAKING_REWARDS] 👥 Found ${usersWithWallets.length} users with connected wallets`,
    )

    // 4. Calculate staked amounts for each user
    const userStakes = new Map<string, number>()
    let totalStaked = 0

    // Build a map of addresses to ensure each address only contributes to one user
    const addressToUser = new Map<string, string>()
    const userToAddresses = new Map<string, string[]>()

    console.log('[STAKING_REWARDS] 📊 Pre-processing address assignments...')

    // Pre-process all users to assign addresses and prevent duplicates
    for (const user of usersWithWallets) {
      const userAddresses: string[] = []

      for (const verification of user.verifications) {
        for (const wallet of verification.connectedWallets) {
          const address = wallet.address.toLowerCase()

          // Skip non-ETH addresses (like Solana addresses)
          if (!isAddress(address)) {
            continue
          }

          // Skip if this address is already assigned to another user
          if (addressToUser.has(address)) {
            console.log(
              `[STAKING_REWARDS] ⚠️  Address ${address} already assigned to another user, skipping for ${user.username}`,
            )
            continue
          }

          userAddresses.push(address)
          // Mark this address as used by this user
          addressToUser.set(address, user.id)
        }
      }

      // Store addresses for this user
      if (userAddresses.length > 0) {
        userToAddresses.set(user.id, userAddresses)
      }
    }

    console.log(
      `[STAKING_REWARDS] 📋 Address assignment complete. ${addressToUser.size} unique addresses assigned to ${userToAddresses.size} users`,
    )

    console.log('[STAKING_REWARDS] 📊 Calculating staked amounts...')

    // Process users and their stakes in batches
    const batchSize = 10

    for (let i = 0; i < usersWithWallets.length; i += batchSize) {
      const userBatch = usersWithWallets.slice(i, i + batchSize)
      const progress = Math.round(
        ((i + batchSize) / usersWithWallets.length) * 100,
      )

      console.log(
        `[STAKING_REWARDS] 📊 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(usersWithWallets.length / batchSize)} (${progress}%)`,
      )

      await Promise.all(
        userBatch.map(async (user) => {
          let userTotalStake = 0

          // Get pre-assigned addresses for this user
          const userAddresses = userToAddresses.get(user.id) || []

          // Check stakes for all addresses in parallel
          if (userAddresses.length > 0) {
            const stakePromises = userAddresses.map(async (address) => {
              try {
                const staked = await publicClient.readContract({
                  address: env.EGGS_CONTRACT_ADDRESS,
                  abi: eggsContractAbi,
                  functionName: 'stakeOf',
                  args: [address as `0x${string}`],
                })

                return Number(formatUnits(staked, 18)) // Convert from wei
              } catch (error) {
                console.error(
                  `[STAKING_REWARDS] ❌ Error reading stake for ${address}:`,
                  error,
                )
                return 0
              }
            })

            const stakes = await Promise.all(stakePromises)
            userTotalStake = stakes.reduce((sum, stake) => sum + stake, 0)
          }

          if (userTotalStake > 0) {
            userStakes.set(user.id, userTotalStake)
            totalStaked += userTotalStake
            console.log(
              `[STAKING_REWARDS] 📈 User ${user.username}: ${userTotalStake} staked`,
            )
          }
        }),
      )
    }

    console.log(
      `[STAKING_REWARDS] 📊 Total staked across all users: ${totalStaked}`,
    )

    if (totalStaked === 0) {
      console.log('[STAKING_REWARDS] ⚠️  No users have staked tokens')
      return {
        totalBurned: totalBurnedLast7Days,
        totalRewards: totalStakingRewards,
        usersRewarded: 0,
      }
    }

    // 5. Calculate and distribute proportional rewards
    const rewardTransactions: Array<{
      userId: string
      amount: number
    }> = []

    for (const [userId, userStake] of userStakes) {
      const userProportion = userStake / totalStaked
      const userReward = totalStakingRewards * userProportion

      if (userReward > 0.01) {
        rewardTransactions.push({
          userId,
          amount: Math.round(userReward * 1000) / 1000,
        })
      }
    }

    console.log(
      `[STAKING_REWARDS] 🎁 Distributing rewards to ${
        rewardTransactions.sort((a, b) => b.amount - a.amount).length
      } users`,
    )

    console.log(rewardTransactions.slice(0, 5))

    // 6. Update database with rewards and transactions
    await prismaClient.$transaction(async (tx) => {
      // Create egg transactions for each reward
      const eggTransactionPromises = rewardTransactions.map((reward) =>
        tx.eggTransaction.create({
          data: {
            userId: reward.userId,
            amount: reward.amount,
            type: TransactionType.STAKING_REWARD,
          },
        }),
      )

      // Update unclaimed eggs for each user
      const userUpdatePromises = rewardTransactions.map((reward) =>
        tx.user.update({
          where: { id: reward.userId },
          data: {
            unclaimedEggs: {
              increment: reward.amount,
            },
          },
        }),
      )

      await Promise.all([...eggTransactionPromises, ...userUpdatePromises])
    })

    const totalDistributed = rewardTransactions.reduce(
      (sum, reward) => sum + reward.amount,
      0,
    )

    const summaryMessage =
      `[STAKING_REWARDS] 🎉 Staking rewards distribution complete:\n` +
      `  🔥 Total burned (7 days): ${totalBurnedLast7Days}\n` +
      `  💰 Total rewards distributed: ${totalDistributed}\n` +
      `  🥩 Total staked: ${totalStaked}\n` +
      `  👥 Users rewarded: ${rewardTransactions.length}`

    console.log(summaryMessage)

    void reportToDiscord(summaryMessage)

    return {
      totalBurned: totalBurnedLast7Days,
      totalRewards: totalDistributed,
      usersRewarded: rewardTransactions.length,
    }
  } catch (error) {
    console.error(
      '[STAKING_REWARDS] ❌ Error in staking rewards distribution:',
      error,
    )
    throw error
  }
}
