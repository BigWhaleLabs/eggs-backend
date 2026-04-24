import { MIN_NEYNAR_SCORE } from './consts'
import neynarApiService from './neynarApiService'
import prismaClient from './prismaClient'
import verifyReferral from './verifyReferral'

interface UpdateSummary {
  totalChecked: number
  usernamesUpdated: number
  usernamesUnchanged: number
  scoresUpdated: number
  scoresUnchanged: number
  errors: number
  referralsVerified: number
}

export default async function updateFarcasterData(): Promise<UpdateSummary> {
  try {
    console.log('[FARCASTER_DATA] 🔄 Starting Farcaster data update...')

    // Get all users with Farcaster verifications
    const verifications = await prismaClient.verification.findMany({
      where: {
        type: 'FARCASTER',
      },
      include: {
        user: true,
      },
    })

    console.log(
      `[FARCASTER_DATA] 📊 Found ${verifications.length} Farcaster verifications to process`,
    )

    const summary: UpdateSummary = {
      totalChecked: verifications.length,
      usernamesUpdated: 0,
      usernamesUnchanged: 0,
      scoresUpdated: 0,
      scoresUnchanged: 0,
      errors: 0,
      referralsVerified: 0,
    }

    const batchSize = 100

    // Process in batches to optimize API calls
    for (let i = 0; i < verifications.length; i += batchSize) {
      const batch = verifications.slice(i, i + batchSize)

      console.log(
        `[FARCASTER_DATA] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(verifications.length / batchSize)}`,
      )

      try {
        // Get all FIDs for this batch
        const fids = batch
          .map((v) => parseInt(v.subjectId))
          .filter((fid) => !isNaN(fid))

        if (fids.length === 0) continue

        // Fetch all users in this batch with a single API call
        const neynarUsers = await neynarApiService.getUsersBulk(fids)

        // Process each verification in the batch
        for (const verification of batch) {
          try {
            const fid = parseInt(verification.subjectId)
            if (isNaN(fid)) {
              summary.errors++
              continue
            }

            const neynarUser = neynarUsers.find((u) => u.fid === fid)
            if (!neynarUser) {
              summary.errors++
              continue
            }

            // Update username if needed
            const newUsername = neynarUser.username
            const currentUsername = verification.user.username

            let usernameUpdated = false
            if (newUsername && newUsername !== currentUsername) {
              // Check if the new username is already taken by another user
              const existingUser = await prismaClient.user.findUnique({
                where: { username: newUsername },
              })

              if (existingUser && existingUser.id !== verification.user.id) {
                console.warn(
                  `[FARCASTER_DATA] ⚠️  Username ${newUsername} already taken, skipping update for FID ${fid}`,
                )
              } else {
                usernameUpdated = true
              }
            }

            // Update user data if needed
            const currentScore = verification.user.neynarUserScore || 0
            const newScore = neynarUser.score
            const scoreUpdated = Math.abs(newScore - currentScore) > 0.001

            if (usernameUpdated || scoreUpdated) {
              const updateData: Record<string, unknown> = {}

              if (usernameUpdated) {
                updateData.username = newUsername
              }

              if (scoreUpdated) {
                updateData.neynarUserScore = newScore
              }

              // Update both user and verification records
              await prismaClient.$transaction([
                prismaClient.user.update({
                  where: { id: verification.user.id },
                  data: updateData,
                }),
                ...(usernameUpdated
                  ? [
                      prismaClient.verification.update({
                        where: { id: verification.id },
                        data: { username: newUsername },
                      }),
                    ]
                  : []),
              ])

              if (usernameUpdated) {
                console.log(
                  `[FARCASTER_DATA] ✅ Updated username for FID ${fid}: ${currentUsername} → ${newUsername}`,
                )
                summary.usernamesUpdated++
              } else {
                summary.usernamesUnchanged++
              }

              if (scoreUpdated) {
                console.log(
                  `[FARCASTER_DATA] ✅ Updated score for FID ${fid}: ${currentScore} → ${newScore}`,
                )
                summary.scoresUpdated++
              } else {
                summary.scoresUnchanged++
              }
            } else {
              summary.usernamesUnchanged++
              summary.scoresUnchanged++
            }

            // Check if user qualifies for referral verification
            if (
              newScore >= MIN_NEYNAR_SCORE &&
              !verification.user.isVerifiedBot
            ) {
              try {
                await verifyReferral({ fid })
                summary.referralsVerified++
              } catch (error) {
                console.error(
                  `[FARCASTER_DATA] Error verifying referral for FID ${fid}:`,
                  error,
                )
              }
            }
          } catch (error) {
            console.error(
              `[FARCASTER_DATA] ❌ Error processing FID ${verification.subjectId}:`,
              error,
            )
            summary.errors++
          }
        }
      } catch (error) {
        console.error(`[FARCASTER_DATA] ❌ Error processing batch:`, error)
        summary.errors += batch.length
      }
    }

    console.log(
      `[FARCASTER_DATA] 🎉 Farcaster data update complete:\n` +
        `  📊 Total checked: ${summary.totalChecked}\n` +
        `  ✅ Usernames updated: ${summary.usernamesUpdated}\n` +
        `  ⭕ Usernames unchanged: ${summary.usernamesUnchanged}\n` +
        `  ✅ Scores updated: ${summary.scoresUpdated}\n` +
        `  ⭕ Scores unchanged: ${summary.scoresUnchanged}\n` +
        `  🔗 Referrals verified: ${summary.referralsVerified}\n` +
        `  ❌ Errors: ${summary.errors}`,
    )

    return summary
  } catch (error) {
    console.error('[FARCASTER_DATA] ❌ Error in Farcaster data update:', error)
    throw error
  }
}
