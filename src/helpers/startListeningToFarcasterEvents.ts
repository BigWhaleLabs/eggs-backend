import {
  getInsecureHubRpcClient,
  HubEvent,
  HubEventType,
  MessageType,
  ReactionType,
} from '@farcaster/hub-nodejs'
import { TippingType } from '@prisma/client'
import isUserSybil from './isUserSybil'
import prismaClient from './prismaClient'

const hubRpcEndpoint = '52.3.147.174:3383'
let isRunning = false
let restartCount = 0
const RESTART_DELAY_MS = 5000 // 5 seconds
const EVENT_TIMEOUT_MS = 600_000 // 600 seconds
let lastEventTime = Date.now()
let watchdogTimer: Timer | null = null

export default function startListeningToFarcasterEvents() {
  if (isRunning) {
    console.log(
      '[FARCASTER_EVENTS] 🔄 Listener already running, skipping start',
    )
    return
  }

  console.log('[FARCASTER_EVENTS] 🚀 Starting Farcaster event listener')
  startListener()
}

async function startListener() {
  isRunning = true
  const client = getInsecureHubRpcClient(hubRpcEndpoint)

  // Start watchdog timer
  const startWatchdog = () => {
    if (watchdogTimer) {
      clearInterval(watchdogTimer)
    }
    watchdogTimer = setInterval(() => {
      const timeSinceLastEvent = Date.now() - lastEventTime
      if (timeSinceLastEvent > EVENT_TIMEOUT_MS) {
        console.warn(
          `[FARCASTER_EVENTS] ⚠️ No events received for ${timeSinceLastEvent}ms, restarting listener`,
        )
        if (watchdogTimer) {
          clearInterval(watchdogTimer)
          watchdogTimer = null
        }
        try {
          client.close()
        } catch (e) {
          console.error(
            '[FARCASTER_EVENTS] Error closing client in watchdog:',
            e,
          )
        }
        scheduleRestart()
      }
    }, 5000) // Check every 5 seconds
  }

  try {
    client.$.waitForReady(Date.now() + 10000, async (e) => {
      if (e) {
        console.error(
          `[FARCASTER_EVENTS] ❌ Failed to connect to gRPC server:`,
          e,
        )
        if (watchdogTimer) {
          clearInterval(watchdogTimer)
          watchdogTimer = null
        }
        scheduleRestart()
        return
      }

      console.log(`[FARCASTER_EVENTS] ✅ Connected to ${hubRpcEndpoint}`)

      try {
        const subscribeResult = await client.subscribe({
          eventTypes: [HubEventType.MERGE_MESSAGE],
        })

        if (subscribeResult.isOk()) {
          const stream = subscribeResult.value
          console.log('[FARCASTER_EVENTS] 🎧 Successfully subscribed to events')

          // Start the watchdog timer after successful subscription
          lastEventTime = Date.now()
          startWatchdog()

          for await (const event of stream) {
            lastEventTime = Date.now() // Update last event time
            try {
              await processEvent(event)
            } catch (error) {
              console.error(
                '[FARCASTER_EVENTS] ❌ Error processing individual event:',
                error,
              )
              // Continue processing other events even if one fails
            }
          }
        } else {
          console.error(
            '[FARCASTER_EVENTS] ❌ Failed to subscribe to events:',
            subscribeResult.error,
          )
          if (watchdogTimer) {
            clearInterval(watchdogTimer)
            watchdogTimer = null
          }
          scheduleRestart()
        }
      } catch (error) {
        console.error('[FARCASTER_EVENTS] ❌ Stream error:', error)
        if (watchdogTimer) {
          clearInterval(watchdogTimer)
          watchdogTimer = null
        }
        scheduleRestart()
      } finally {
        if (watchdogTimer) {
          clearInterval(watchdogTimer)
          watchdogTimer = null
        }
        try {
          client.close()
        } catch (closeError) {
          console.error(
            '[FARCASTER_EVENTS] ❌ Error closing client:',
            closeError,
          )
        }
        isRunning = false
      }
    })
  } catch (error) {
    console.error(
      '[FARCASTER_EVENTS] ❌ Unexpected error in startListener:',
      error,
    )
    if (watchdogTimer) {
      clearInterval(watchdogTimer)
      watchdogTimer = null
    }
    scheduleRestart()
  }
}

function scheduleRestart() {
  isRunning = false
  restartCount++

  console.log(
    `[FARCASTER_EVENTS] 🔄 Scheduling restart attempt ${restartCount} in ${RESTART_DELAY_MS}ms`,
  )

  setTimeout(() => {
    console.log(
      `[FARCASTER_EVENTS] 🔄 Restarting listener (attempt ${restartCount})`,
    )
    startListener()
  }, RESTART_DELAY_MS)
}

async function processEvent(event: unknown) {
  const hubEvent = event as HubEvent

  // Handle the actual structure: mergeMessageBody.message
  if (!hubEvent.mergeMessageBody?.message) {
    return
  }

  const message = hubEvent.mergeMessageBody.message
  const fid = message.data?.fid
  const isLike =
    message.data?.type === MessageType.REACTION_ADD &&
    message.data.reactionBody?.type === ReactionType.LIKE
  const isReply =
    message.data?.type === MessageType.CAST_ADD &&
    !!message.data.castAddBody?.parentCastId
  const isFollow =
    message.data?.type === MessageType.LINK_ADD &&
    message.data.linkBody?.type === 'follow'

  // Wrap the entire processing in a transaction to prevent race conditions
  await prismaClient.$transaction(async (tx) => {
    // 1. Find the user by fid through farcaster verifications
    const tippingUser = await tx.user.findFirst({
      where: {
        verifications: {
          some: {
            subjectId: fid?.toString(),
            type: 'FARCASTER',
          },
        },
      },
    })

    // 2. If no user, bail (this isn't an error)
    if (!tippingUser) {
      return
    }

    if (isLike) {
      // 3. If it is like and user has 0 allocation for likes, bail
      if (tippingUser.tipsLeftForLikes <= 0) {
        return
      }

      // 6. If it's a like and user doesn't have 5 $eggs to tip, use up the rest of user's allocation
      const tipAmount = Math.min(5, tippingUser.tipsLeftForLikes)

      // Safeguard: ensure tipAmount is positive
      if (tipAmount <= 0) {
        console.log(
          `[FARCASTER_TIPS] 🚫 ${tippingUser.username} has invalid tip amount ${tipAmount} for like, skipping`,
        )
        return
      }

      // 7. If it's a like, find the user that is being liked, find them by fid
      const targetCastId = message.data?.reactionBody?.targetCastId
      if (!targetCastId?.fid) {
        console.log(
          `[FARCASTER_TIPS] 🚫 No target cast FID found for like, skipping`,
        )
        return
      }

      const tippedUser = await tx.user.findFirst({
        where: {
          verifications: {
            some: {
              subjectId: targetCastId.fid.toString(),
              type: 'FARCASTER',
            },
          },
        },
      })

      if (!tippedUser) {
        console.log(
          `[FARCASTER_TIPS] 🚫 No user found for target FID ${targetCastId.fid}, skipping like tip`,
        )
        return
      }

      // Check if user is trying to tip themselves
      if (tippingUser.id === tippedUser.id) {
        console.log(
          `[FARCASTER_TIPS] 🚫 ${tippingUser.username} cannot tip themselves, skipping like tip`,
        )
        return
      }

      // 8. If user being tipped is isVerifiedBot, bail
      if (tippedUser.isVerifiedBot) {
        console.log(
          `[FARCASTER_TIPS] 🚫 Target user ${tippedUser.username} is a verified bot, skipping like tip`,
        )
        return
      }

      // 9. Like increments unclaimed eggs for user being tipped by 5 $eggs (or whatever tipper has) and decrements tipper allocation
      await tx.user.update({
        where: { id: tippedUser.id },
        data: {
          unclaimedEggs: {
            increment: tipAmount,
          },
        },
      })

      // Update with a check to prevent race conditions - only decrement if sufficient tips left
      const updateResult = await tx.user.updateMany({
        where: {
          id: tippingUser.id,
          tipsLeftForLikes: {
            gte: tipAmount,
          },
        },
        data: {
          tipsLeftForLikes: {
            decrement: tipAmount,
          },
        },
      })

      // If update failed (count = 0), it means allocation was insufficient due to race condition
      if (updateResult.count === 0) {
        console.log(
          `[FARCASTER_TIPS] ⚠️ Race condition detected: ${tippingUser.username} no longer has ${tipAmount} tips for likes, rolling back`,
        )
        throw new Error('Insufficient tips due to race condition')
      }

      // Create egg transaction for the tip
      await tx.eggTransaction.create({
        data: {
          userId: tippedUser.id,
          senderId: tippingUser.id,
          amount: tipAmount,
          type: 'TIP_RECEIVED',
        },
      })

      console.log('Creating tip tx for cast id', JSON.stringify(targetCastId))
      console.log(
        'Creating tip tx for cast id hash',
        JSON.stringify(targetCastId.hash),
      )

      await tx.tippingTransaction.create({
        data: {
          tipperId: tippingUser.id,
          tippedUserId: tippedUser.id,
          amount: tipAmount,
          type: TippingType.LIKE,
          farcasterCastHash: targetCastId.hash.toString(),
        },
      })

      console.log(
        `[FARCASTER_TIPS] 👍 ${tippingUser.username} tipped ${tippedUser.username} ${tipAmount} $EGGS via like`,
      )
    } else if (isReply) {
      const replyText = message.data?.castAddBody?.text || ''

      // 4. If it is reply, check how much the user is tipping in format "10 $eggs" and the number can be anywhere in the text, as well as cashtag $eggs
      const tipMatch = replyText.match(/(\d+(?:\.\d+)?)\s*\$eggs?/i)
      if (!tipMatch) {
        return
      }

      const requestedTipAmount = parseFloat(tipMatch[1])

      // Validate that the tip amount is positive and greater than 0
      if (requestedTipAmount <= 0 || !isFinite(requestedTipAmount)) {
        console.log(
          `[FARCASTER_TIPS] 🚫 Invalid tip amount ${requestedTipAmount}, skipping reply tip`,
        )
        return
      }

      // 5. If reply, check if user has enough allocation, if not, bail
      if (tippingUser.tipsLeftForComments < requestedTipAmount) {
        console.log(
          `[FARCASTER_TIPS] 🚫 ${tippingUser.username} has insufficient comment tips (${tippingUser.tipsLeftForComments}) for requested ${requestedTipAmount}, skipping reply tip`,
        )
        return
      }

      // Additional safeguard: ensure tipsLeftForComments is not negative
      if (tippingUser.tipsLeftForComments < 0) {
        console.log(
          `[FARCASTER_TIPS] 🚫 ${tippingUser.username} has negative comment tips (${tippingUser.tipsLeftForComments}), skipping reply tip`,
        )
        return
      }

      const parentCastId = message.data?.castAddBody?.parentCastId
      if (!parentCastId?.fid) {
        console.log(
          `[FARCASTER_TIPS] 🚫 No parent cast FID found for reply, skipping`,
        )
        return
      }

      const tippedUser = await tx.user.findFirst({
        where: {
          verifications: {
            some: {
              subjectId: parentCastId.fid.toString(),
              type: 'FARCASTER',
            },
          },
        },
      })

      if (!tippedUser) {
        console.log(
          `[FARCASTER_TIPS] 🚫 No user found for parent FID ${parentCastId.fid}, skipping reply tip`,
        )
        return
      }

      // Check if user is trying to tip themselves
      if (tippingUser.id === tippedUser.id) {
        console.log(
          `[FARCASTER_TIPS] 🚫 ${tippingUser.username} cannot tip themselves, skipping reply tip`,
        )
        return
      }

      // 8. If user being tipped is isVerifiedBot, bail
      if (tippedUser.isVerifiedBot) {
        console.log(
          `[FARCASTER_TIPS] 🚫 Target user ${tippedUser.username} is a verified bot, skipping reply tip`,
        )
        return
      }

      // 10. Reply increments unclaimed eggs for the tipped user by the amount specified in text (e.g. 100 $eggs) and decrements the tipper allocation
      await tx.user.update({
        where: { id: tippedUser.id },
        data: {
          unclaimedEggs: {
            increment: requestedTipAmount,
          },
        },
      })

      // Update with a check to prevent race conditions - only decrement if sufficient tips left
      const updateResult = await tx.user.updateMany({
        where: {
          id: tippingUser.id,
          tipsLeftForComments: {
            gte: requestedTipAmount,
          },
        },
        data: {
          tipsLeftForComments: {
            decrement: requestedTipAmount,
          },
        },
      })

      // If update failed (count = 0), it means allocation was insufficient due to race condition
      if (updateResult.count === 0) {
        console.log(
          `[FARCASTER_TIPS] ⚠️ Race condition detected: ${tippingUser.username} no longer has ${requestedTipAmount} tips for comments, rolling back`,
        )
        throw new Error('Insufficient tips due to race condition')
      }

      // Create egg transaction for the tip
      await tx.eggTransaction.create({
        data: {
          userId: tippedUser.id,
          senderId: tippingUser.id,
          amount: requestedTipAmount,
          type: 'TIP_RECEIVED',
        },
      })

      await tx.tippingTransaction.create({
        data: {
          tipperId: tippingUser.id,
          tippedUserId: tippedUser.id,
          amount: requestedTipAmount,
          type: TippingType.REPLY,
          farcasterCastHash: parentCastId.hash.toString(),
          farcasterReplyText: replyText,
        },
      })

      console.log(
        `[FARCASTER_TIPS] 💬 ${tippingUser.username} tipped ${tippedUser.username} ${requestedTipAmount} $EGGS via reply: "${replyText.substring(0, 50)}..."`,
      )
    } else if (isFollow) {
      // Handle follow events - when someone follows a user, the followed user tips the follower
      const followerFid = fid // The person who is following
      const targetFid = message.data?.linkBody?.targetFid // The person being followed

      if (!followerFid || !targetFid) {
        return
      }

      // Find the user who was followed (target) - this is the tipping user
      const tippingUser = await tx.user.findFirst({
        where: {
          verifications: {
            some: {
              subjectId: targetFid.toString(),
              type: 'FARCASTER',
            },
          },
        },
      })

      if (!tippingUser) {
        return
      }

      // Check if there's already a follow event for this follower and followed user
      const existingFollowEvent = await tx.followEvent.findUnique({
        where: {
          followerFid_followedUserId: {
            followerFid: followerFid.toString(),
            followedUserId: tippingUser.id,
          },
        },
      })

      if (existingFollowEvent) {
        return
      }

      // Record the follow event
      await tx.followEvent.upsert({
        where: {
          followerFid_followedUserId: {
            followerFid: followerFid.toString(),
            followedUserId: tippingUser.id,
          },
        },
        update: {},
        create: {
          followerFid: followerFid.toString(),
          followedUserId: tippingUser.id,
        },
      })

      // Check if the followed user has follow tips left
      if (tippingUser.tipsLeftForFollows <= 0) {
        return
      }

      // Find the user who is following (follower) - this is the tipped user
      const tippedUser = await tx.user.findFirst({
        where: {
          verifications: {
            some: {
              subjectId: followerFid.toString(),
              type: 'FARCASTER',
            },
          },
        },
      })

      // If we can't find the follower user, they're not registered, so no tip
      if (!tippedUser) {
        return
      }

      // Check if the follower is a sybil user
      const sybilCheck = await isUserSybil({ id: tippedUser.id, prisma: tx })
      if (sybilCheck.isSybil) {
        return
      }

      // Check if user is trying to tip themselves
      if (tippingUser.id === tippedUser.id) {
        return
      }

      // Check if user being tipped is a verified bot
      if (tippedUser.isVerifiedBot) {
        return
      }

      const tipAmount = Math.min(10, tippingUser.tipsLeftForFollows) // Tip 10 $EGGS or whatever is left

      // Safeguard: ensure tipAmount is positive
      if (tipAmount <= 0) {
        return
      }

      // Give tip to the follower and reduce followed user's allocation
      await tx.user.update({
        where: { id: tippedUser.id },
        data: {
          unclaimedEggs: {
            increment: tipAmount,
          },
        },
      })

      // Update with a check to prevent race conditions - only decrement if sufficient tips left
      const updateResult = await tx.user.updateMany({
        where: {
          id: tippingUser.id,
          tipsLeftForFollows: {
            gte: tipAmount,
          },
        },
        data: {
          tipsLeftForFollows: {
            decrement: tipAmount,
          },
        },
      })

      // If update failed (count = 0), it means allocation was insufficient due to race condition
      if (updateResult.count === 0) {
        return
      }

      // Create egg transaction for the tip
      await tx.eggTransaction.create({
        data: {
          userId: tippedUser.id,
          senderId: tippingUser.id,
          amount: tipAmount,
          type: 'TIP_RECEIVED',
        },
      })

      console.log(
        `[FARCASTER_EVENTS] 👥 ${tippingUser.username} tipped ${tippedUser.username} ${tipAmount} $EGGS for following`,
      )
    }
  })
}
