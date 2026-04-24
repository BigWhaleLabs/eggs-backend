import { formatUnits, isAddress } from 'viem'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import fetchFollowersFromHub from './fetchFollowersFromHub'
import getEligibleUsers from './getEligibleUsers'
import prismaClient from './prismaClient'
import reportToDiscord from './reportToDiscord'
import { publicClient } from './wallet'

export default async function calculateTipAllocation() {
  try {
    console.log(
      '[TIP_ALLOCATION] 🧮 Starting daily tip allocation calculation...',
    )

    // 1. Get number of $EGGS burned in the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const burnEvents = await prismaClient.burnEvent.findMany({
      where: {
        timestamp: {
          gte: twentyFourHoursAgo,
        },
      },
    })

    const totalBurnedLast24h = burnEvents.reduce(
      (sum, event) => sum + event.tokenAmount,
      0,
    )

    console.log(
      `[TIP_ALLOCATION] 📊 Total $EGGS burned in last 24h: ${totalBurnedLast24h}`,
    )

    // 2. 25% of burned tokens allocated to tips
    const totalTipAllocation = totalBurnedLast24h * 0.25

    console.log(
      `[TIP_ALLOCATION] 💰 Total tip allocation: ${totalTipAllocation}`,
    )

    if (totalTipAllocation === 0) {
      console.log(
        '[TIP_ALLOCATION] ⚠️  No tips to allocate, but will still save holdings',
      )
      // Continue execution to save holdings even when no tips are allocated
    }

    // 3. Find all eligible users with connected wallets (have claimed eggs or 3+ hens)
    const usersWithWallets = await getEligibleUsers()

    console.log(
      `[TIP_ALLOCATION] 👥 Found ${usersWithWallets.length} users with connected wallets`,
    )

    // Build a map of addresses to ensure each address only contributes to one user
    const addressToUser = new Map<string, string>()
    const userToAddresses = new Map<string, string[]>()
    const userBalances = new Map<string, number>()

    // Pre-process all users to assign addresses and prevent duplicates
    console.log('[TIP_ALLOCATION] � Pre-processing address assignments...')
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
              `[TIP_ALLOCATION] ⚠️  Address ${address} already assigned to another user, skipping for ${user.username}`,
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
      `[TIP_ALLOCATION] 📋 Address assignment complete. ${addressToUser.size} unique addresses assigned to ${userToAddresses.size} users`,
    )

    // Process users and their balances in batches
    let eligibleUsers = 0
    const MIN_BALANCE = 15000 // 15,000 $EGGS minimum
    const batchSize = 10

    console.log('[TIP_ALLOCATION] 📊 Starting balance checks in batches...')

    for (let i = 0; i < usersWithWallets.length; i += batchSize) {
      const userBatch = usersWithWallets.slice(i, i + batchSize)
      const progress = Math.round(
        ((i + batchSize) / usersWithWallets.length) * 100,
      )

      console.log(
        `[TIP_ALLOCATION] 📊 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(usersWithWallets.length / batchSize)} (${progress}%)`,
      )

      // Use Promise.allSettled to prevent one user's failure from stopping the entire batch
      const batchResults = await Promise.allSettled(
        userBatch.map(async (user) => {
          let totalUserBalance = 0

          // Get pre-assigned addresses for this user
          const userAddresses = userToAddresses.get(user.id) || []

          // Check balances for all addresses in parallel
          if (userAddresses.length > 0) {
            const balancePromises = userAddresses.map(async (address) => {
              try {
                // Add timeout to prevent hanging on slow RPC responses
                const timeoutPromise = new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('RPC timeout')), 15000),
                )

                // Use Promise.allSettled to prevent one failure from stopping both calls
                const [balanceResult, stakedResult] = await Promise.race([
                  Promise.allSettled([
                    publicClient.readContract({
                      address: env.EGGS_CONTRACT_ADDRESS,
                      abi: eggsContractAbi,
                      functionName: 'balanceOf',
                      args: [address as `0x${string}`],
                    }),
                    publicClient.readContract({
                      address: env.EGGS_CONTRACT_ADDRESS,
                      abi: eggsContractAbi,
                      functionName: 'stakeOf',
                      args: [address as `0x${string}`],
                    }),
                  ]),
                  timeoutPromise,
                ])

                const balance =
                  balanceResult.status === 'fulfilled'
                    ? balanceResult.value
                    : 0n
                const staked =
                  stakedResult.status === 'fulfilled' ? stakedResult.value : 0n

                return Number(formatUnits(balance + staked, 18)) // Convert from wei, include staked
              } catch (error) {
                console.error(
                  `[TIP_ALLOCATION] ❌ Error reading balance for ${address}:`,
                  error,
                )
                return 0
              }
            })

            const balanceResults = await Promise.allSettled(balancePromises)
            const successfulBalances = balanceResults
              .filter((result) => result.status === 'fulfilled')
              .map((result) => result.value)

            totalUserBalance = successfulBalances.reduce(
              (sum, balance) => sum + balance,
              0,
            )

            // Log if some balance reads failed
            const failedReads = balanceResults.filter(
              (result) => result.status === 'rejected',
            ).length
            if (failedReads > 0) {
              console.warn(
                `[TIP_ALLOCATION] ⚠️  ${failedReads}/${userAddresses.length} balance reads failed for user ${user.username}`,
              )
            }
          }

          return {
            user,
            totalUserBalance,
          }
        }),
      )

      // Process batch results
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { user, totalUserBalance } = result.value

          // Always store user balance, regardless of minimum threshold
          userBalances.set(user.id, totalUserBalance)

          // Only count as eligible for tips if they meet minimum balance
          if (totalUserBalance >= MIN_BALANCE) {
            eligibleUsers++
          }
        } else {
          console.error(
            `[TIP_ALLOCATION] ❌ Failed to process user in batch:`,
            result.reason,
          )
        }
      })
    }

    console.log(
      `[TIP_ALLOCATION] ✅ Found ${eligibleUsers} eligible users with >= ${MIN_BALANCE} $EGGS (out of ${userBalances.size} total users)`,
    )

    // Calculate total holdings of only eligible users for tip distribution
    const eligibleUserBalances = new Map<string, number>()
    for (const [userId, balance] of userBalances) {
      if (balance >= MIN_BALANCE) {
        eligibleUserBalances.set(userId, balance)
      }
    }

    const totalHoldings = Array.from(eligibleUserBalances.values()).reduce(
      (sum, balance) => sum + balance,
      0,
    )

    // 3.5. Track followers for eligible users
    console.log(
      '[TIP_ALLOCATION] 🔍 Starting follow tracking for eligible users...',
    )

    // Get eligible users with their FIDs for follow tracking
    const eligibleUsersWithFids = await prismaClient.user.findMany({
      where: {
        id: {
          in: Array.from(eligibleUserBalances.keys()),
        },
        verifications: {
          some: {
            type: 'FARCASTER',
          },
        },
      },
      select: {
        id: true,
        verifications: {
          where: {
            type: 'FARCASTER',
          },
          select: {
            subjectId: true,
          },
          take: 1, // Only take the first Farcaster verification
        },
      },
    })

    const eligibleUsersForFollowTracking = eligibleUsersWithFids
      .map((user) => ({
        userId: user.id,
        fid: user.verifications[0]?.subjectId,
      }))
      .filter((user) => user.fid) // Only include users with FIDs

    console.log(
      `[TIP_ALLOCATION] 👥 Found ${eligibleUsersForFollowTracking.length} eligible users with Farcaster FIDs for follow tracking`,
    )

    if (eligibleUsersForFollowTracking.length > 0) {
      try {
        await fetchFollowersFromHub(eligibleUsersForFollowTracking)
        console.log(
          '[TIP_ALLOCATION] ✅ Follow tracking completed successfully',
        )
      } catch (error) {
        console.error(
          '[TIP_ALLOCATION] ❌ Error during follow tracking:',
          error,
        )

        // Report follow tracking failure to Discord (non-critical)
        try {
          await reportToDiscord(
            `⚠️ **Follow Tracking Failed in Tip Allocation**\n\n` +
              `**Error:** ${error instanceof Error ? error.message : String(error)}\n\n` +
              `**Impact:** Tip allocation will continue, but follow data may be outdated\n` +
              `**Time:** ${new Date().toISOString()}\n` +
              `**Note:** This is non-critical, tip allocation proceeding normally`,
          )
        } catch (discordError) {
          console.error(
            '[TIP_ALLOCATION] ❌ Failed to report follow tracking error to Discord:',
            discordError,
          )
        }

        // Continue with tip allocation even if follow tracking fails
      }
    } else {
      console.log(
        '[TIP_ALLOCATION] ⚠️  No eligible users with FIDs found for follow tracking',
      )
    }

    // 4. Split allocation: 30% for likes, 40% for comments, 30% for follows
    const likeTipAllocation = totalTipAllocation * 0.3
    const commentTipAllocation = totalTipAllocation * 0.4
    const followTipAllocation = totalTipAllocation * 0.3

    console.log(
      `[TIP_ALLOCATION] 📊 Allocation split - Likes: ${likeTipAllocation}, Comments: ${commentTipAllocation}, Follows: ${followTipAllocation}`,
    )

    // 5. Calculate proportional tips for eligible users and prepare updates for all users
    let updatedUsers = 0
    const userUpdates: Array<{
      userId: string
      likes: number
      comments: number
      follows: number
      holdings: number
    }> = []

    // Process all users (for holdings) but only calculate tips for eligible users
    for (const [userId, userBalance] of userBalances) {
      let userLikeTips = 0
      let userCommentTips = 0
      let userFollowTips = 0

      // Only calculate tips for eligible users
      if (userBalance >= MIN_BALANCE && totalHoldings > 0) {
        const userProportion = userBalance / totalHoldings
        userLikeTips = Math.floor(likeTipAllocation * userProportion)
        userCommentTips = Math.floor(commentTipAllocation * userProportion)
        userFollowTips = Math.floor(followTipAllocation * userProportion)
      }

      userUpdates.push({
        userId,
        likes: userLikeTips,
        comments: userCommentTips,
        follows: userFollowTips,
        holdings: userBalance, // Always save holdings regardless of eligibility
      })
    }

    // Batch update all users
    try {
      await prismaClient.$transaction(
        userUpdates.map((update) =>
          prismaClient.user.update({
            where: { id: update.userId },
            data: {
              tipsLeftForLikes: update.likes,
              tipsLeftForComments: update.comments,
              tipsLeftForFollows: update.follows,
              totalHoldings: update.holdings,
            },
          }),
        ),
      )
    } catch (dbError) {
      console.error('[TIP_ALLOCATION] ❌ Database transaction failed:', dbError)

      // Report database failure to Discord
      try {
        await reportToDiscord(
          `🚨 **TIP ALLOCATION DATABASE FAILURE** 🚨\n\n` +
            `**Error:** Failed to update user tips and holdings in database\n\n` +
            `**Details:** ${dbError instanceof Error ? dbError.message : String(dbError)}\n\n` +
            `**Impact:** Tip allocation calculation completed but user updates failed\n` +
            `**Time:** ${new Date().toISOString()}\n` +
            `**Action Required:** Manual database update may be needed`,
        )
      } catch (discordError) {
        console.error(
          '[TIP_ALLOCATION] ❌ Failed to report DB error to Discord:',
          discordError,
        )
      }

      throw dbError
    }

    updatedUsers = userUpdates.length

    console.log(
      `[TIP_ALLOCATION] 🎉 Tip allocation complete:\n` +
        `  🔥 Total burned (24h): ${totalBurnedLast24h}\n` +
        `  💰 Total allocated: ${totalTipAllocation}\n` +
        `  👍 Like tips: ${likeTipAllocation}\n` +
        `  💬 Comment tips: ${commentTipAllocation}\n` +
        `  👥 Follow tips: ${followTipAllocation}\n` +
        `  � Total users updated: ${updatedUsers}\n` +
        `  🎯 Eligible tip recipients: ${eligibleUsers}`,
    )

    try {
      await reportToDiscord(
        `💰 **Daily Tip Allocation Complete**\n\n` +
          `🔥 **Total Burned (24h):** ${totalBurnedLast24h.toLocaleString()} $EGGS\n` +
          `💰 **Total Allocated:** ${totalTipAllocation.toLocaleString()} $EGGS\n\n` +
          `**Distribution:**\n` +
          `👍 Like tips: ${likeTipAllocation.toLocaleString()} $EGGS\n` +
          `💬 Comment tips: ${commentTipAllocation.toLocaleString()} $EGGS\n` +
          `👥 Follow tips: ${followTipAllocation.toLocaleString()} $EGGS\n\n` +
          `📊 **Users Updated:** ${updatedUsers.toLocaleString()}\n` +
          `🎯 **Eligible Recipients:** ${eligibleUsers.toLocaleString()}`,
      )
    } catch (discordError) {
      console.error(
        '[TIP_ALLOCATION] ❌ Failed to send Discord notification:',
        discordError,
      )
      // Don't throw the error - tip allocation should still be considered successful
    }

    return {
      totalBurned: totalBurnedLast24h,
      totalAllocated: totalTipAllocation,
      usersUpdated: updatedUsers,
    }
  } catch (error) {
    console.error('[TIP_ALLOCATION] ❌ Error in tip allocation:', error)

    // Report critical error to Discord
    try {
      await reportToDiscord(
        `🚨 **TIP ALLOCATION FAILED** 🚨\n\n` +
          `**Error:** ${error instanceof Error ? error.message : String(error)}\n\n` +
          `**Stack Trace:**\n\`\`\`\n${error instanceof Error ? error.stack : 'No stack trace available'}\n\`\`\`\n\n` +
          `**Time:** ${new Date().toISOString()}\n` +
          `**Action Required:** Manual investigation needed`,
      )
    } catch (discordError) {
      console.error(
        '[TIP_ALLOCATION] ❌ Failed to report error to Discord:',
        discordError,
      )
    }

    throw error
  }
}
