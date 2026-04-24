import { getInsecureHubRpcClient, Message } from '@farcaster/hub-nodejs'
import prismaClient from './prismaClient'

const hubRpcEndpoint = '3.230.187.250:3383'

export default async function fetchFollowersFromHub(
  eligibleUsers: Array<{ userId: string; fid?: string }>,
) {
  console.log(
    `[FOLLOW_TRACKING] 🔍 Starting to fetch followers for ${eligibleUsers.length} eligible users...`,
  )

  const client = getInsecureHubRpcClient(hubRpcEndpoint)

  return new Promise<void>((resolve, reject) => {
    client.$.waitForReady(Date.now() + 10000, async (e) => {
      if (e) {
        console.error(
          `[FOLLOW_TRACKING] ❌ Failed to connect to gRPC server:`,
          e,
        )
        reject(e)
        return
      }

      console.log(`[FOLLOW_TRACKING] ✅ Connected to ${hubRpcEndpoint}`)

      try {
        let totalFollowEvents = 0
        let processedUsers = 0

        for (const user of eligibleUsers) {
          if (!user.fid) {
            console.log(
              `[FOLLOW_TRACKING] ⚠️  User ${user.userId} has no FID, skipping`,
            )
            continue
          }

          const fid = parseInt(user.fid)
          if (isNaN(fid)) {
            console.log(
              `[FOLLOW_TRACKING] ⚠️  Invalid FID ${user.fid} for user ${user.userId}, skipping`,
            )
            continue
          }

          try {
            console.log(
              `[FOLLOW_TRACKING] 📊 Fetching followers for user ${user.userId} (FID: ${fid})...`,
            )

            // Get links where this user is the target (people following them)
            const linksResult = await client.getLinksByTarget({
              targetFid: fid,
              linkType: 'follow',
            })

            if (linksResult.isErr()) {
              console.error(
                `[FOLLOW_TRACKING] ❌ Error fetching links for FID ${fid}:`,
                linksResult.error,
              )
              continue
            }

            const followLinks = linksResult.value.messages

            console.log(
              `[FOLLOW_TRACKING] 📈 Found ${followLinks.length} followers for user ${user.userId} (FID: ${fid})`,
            )

            // Process followers in batches to avoid overwhelming the database
            const batchSize = 100
            let batchFollowEvents = 0

            for (let i = 0; i < followLinks.length; i += batchSize) {
              const batch = followLinks.slice(i, i + batchSize)
              const followEvents = batch
                .map((link: Message) => {
                  const followerFid = link.data?.fid
                  if (!followerFid) return null

                  return {
                    followerFid: followerFid.toString(),
                    followedUserId: user.userId,
                  }
                })
                .filter(Boolean) as Array<{
                followerFid: string
                followedUserId: string
              }>

              if (followEvents.length > 0) {
                try {
                  // Use upsert to avoid duplicate key errors
                  await prismaClient.$transaction(
                    followEvents.map((event) =>
                      prismaClient.followEvent.upsert({
                        where: {
                          followerFid_followedUserId: {
                            followerFid: event.followerFid,
                            followedUserId: event.followedUserId,
                          },
                        },
                        update: {
                          updatedAt: new Date(),
                        },
                        create: {
                          followerFid: event.followerFid,
                          followedUserId: event.followedUserId,
                        },
                      }),
                    ),
                  )

                  batchFollowEvents += followEvents.length
                  console.log(
                    `[FOLLOW_TRACKING] ✅ Processed batch of ${followEvents.length} follow events for user ${user.userId}`,
                  )
                } catch (error) {
                  console.error(
                    `[FOLLOW_TRACKING] ❌ Error saving follow events batch for user ${user.userId}:`,
                    error,
                  )
                }
              }
            }

            totalFollowEvents += batchFollowEvents
            processedUsers++

            const progress = Math.round(
              (processedUsers / eligibleUsers.length) * 100,
            )
            console.log(
              `[FOLLOW_TRACKING] 📊 Processed user ${user.userId}: ${batchFollowEvents} follow events (${processedUsers}/${eligibleUsers.length} - ${progress}%)`,
            )
          } catch (error) {
            console.error(
              `[FOLLOW_TRACKING] ❌ Error processing user ${user.userId} (FID: ${fid}):`,
              error,
            )
          }
        }

        console.log(
          `[FOLLOW_TRACKING] 🎉 Follow tracking complete:\n` +
            `  👥 Processed users: ${processedUsers}/${eligibleUsers.length}\n` +
            `  📈 Total follow events recorded: ${totalFollowEvents}`,
        )

        resolve()
      } catch (error) {
        console.error(
          '[FOLLOW_TRACKING] ❌ Error in fetchFollowersFromHub:',
          error,
        )
        reject(error)
      } finally {
        try {
          client.close()
        } catch (closeError) {
          console.error(
            '[FOLLOW_TRACKING] ❌ Error closing client:',
            closeError,
          )
        }
      }
    })
  })
}
