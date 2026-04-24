import 'core-js'
import 'reflect-metadata'

import { relationResolvers } from '@generated/type-graphql/index'
import {
  GraphQLDeferDirective,
  GraphQLStreamDirective,
} from '@graphql-tools/utils'
import { GraphQLIncludeDirective } from 'graphql'
import { createYoga, type YogaInitialContext } from 'graphql-yoga'
import handleFarcasterWebhook from 'helpers/handleFarcasterWebhook'
import isUserSybil from 'helpers/isUserSybil'
import { verifyAuthToken } from 'helpers/jwt'
import prismaClient from 'helpers/prismaClient'
import {
  PROXY_AUTH_MESSAGE,
  verifyEvmSignature,
} from 'helpers/verifyEvmSignature'
import type Context from 'models/Context'
import henStatsStream from 'og/henStatsStream'
import { cwd } from 'process'
import ChickenLevelUpgradeResolver from 'resolvers/ChickenLevelUpgradeResolver'
import EggResolver from 'resolvers/EggsResolver'
import HenModelResolver from 'resolvers/HenModelResolver'
import HenResolver from 'resolvers/HenResolver'
import LoginResolver from 'resolvers/LoginResolver'
import ProxyResolver from 'resolvers/ProxyResolver'
import UserModelResolver from 'resolvers/UserModelResolver'
import { UserResolver } from 'resolvers/UserResolver'
import { buildSchema } from 'type-graphql'

const schema = await buildSchema({
  authChecker: ({ context }: { context: Context }, roles: string[]) => {
    return roles.length === 0 && !!context.user
  },
  directives: [
    GraphQLIncludeDirective,
    GraphQLDeferDirective,
    GraphQLStreamDirective,
  ],
  resolvers: [
    ...relationResolvers,
    LoginResolver,
    UserResolver,
    EggResolver,
    HenResolver,
    UserModelResolver,
    ChickenLevelUpgradeResolver,
    HenModelResolver,
    ProxyResolver,
    // DegenResolver,
  ],
  validate: true,
})

const yoga = createYoga({
  batching: true,
  context: async ({
    connectionParams,
    request,
  }: YogaInitialContext & {
    connectionParams: {
      authorization?: string
      proxyauthorization?: string
    }
  }) => {
    const token: string | undefined =
      request?.headers.get('authorization') || connectionParams?.authorization
    const proxyAuthSignature: string | undefined =
      request?.headers.get('proxyauthorization') ||
      connectionParams?.proxyauthorization
    const replayToken: string | undefined =
      request?.headers.get('replay-token') || undefined
    const source: string | undefined =
      request?.headers.get('source') || undefined

    // Handle proxy authorization first
    if (proxyAuthSignature) {
      const proxyAddress = verifyEvmSignature(
        PROXY_AUTH_MESSAGE,
        proxyAuthSignature,
      )

      if (proxyAddress) {
        // Find the user associated with this proxy address
        const proxy = await prismaClient.proxy.findUnique({
          where: { address: proxyAddress },
        })
        if (proxy) {
          const user = await prismaClient.user.findFirst({
            where: {
              id: proxy?.userId,
            },
          })
          if (!user) {
            console.warn(
              `[PROXY_AUTH] No user found for proxy address ${proxyAddress}`,
            )
            return { prisma: prismaClient }
          }
          return {
            prisma: prismaClient,
            user,
            source,
            proxyAddress,
          }
        } else {
          console.warn(
            `[PROXY_AUTH] Invalid proxy address ${proxyAddress} - no associated user found`,
          )
        }
      } else {
        console.warn(`[PROXY_AUTH] Invalid proxy signature provided`)
      }
    }

    // Fall back to regular token authorization
    if (!token) return { prisma: prismaClient }

    try {
      verifyAuthToken(token)
    } catch {
      return { prisma: prismaClient }
    }

    const user = await prismaClient.user.findFirst({
      where: {
        authTokens: {
          some: {
            token,
          },
        },
      },
    })

    if (!user) return { prisma: prismaClient }

    // Check for bot indicators and flag user
    let shouldUpdateUser = false
    const updateData: {
      repeatsReplayTokens?: boolean
    } = {}

    // Check for replay token reuse (bot indicator)
    if (replayToken) {
      try {
        // Try to create the replay token first
        await prismaClient.replayToken.create({
          data: {
            token: replayToken,
            userId: user.id,
          },
        })
        // Success - first time seeing this token
      } catch (error) {
        // Token already exists
        if (
          error instanceof Error &&
          error.message?.includes('Unique constraint')
        ) {
          // Get the existing token to check timing
          const existingToken = await prismaClient.replayToken.findUnique({
            where: { token: replayToken },
            select: { createdAt: true, userId: true },
          })

          if (existingToken) {
            const timeDiff = Date.now() - existingToken.createdAt.getTime()
            const GRACE_PERIOD = 30_000 // 30 seconds for legitimate retries

            // Only flag as bot if:
            // 1. Token is older than grace period (not a retry)
            // 2. Token belongs to same user (preventing cross-user token reuse)
            if (timeDiff > GRACE_PERIOD && existingToken.userId === user.id) {
              if (!user.repeatsReplayTokens) {
                console.log(
                  `[BOT_DETECTION] 🤖 User ${user.username} reused old replay token ${replayToken} (${timeDiff}ms old), flagging as bot`,
                )
                updateData.repeatsReplayTokens = true
                shouldUpdateUser = true
              }
            } else {
              console.log(
                `[BOT_DETECTION] ⚪ User ${user.username} replay token retry within grace period (${timeDiff}ms)`,
              )
            }
          }
        } else {
          console.error('[BOT_DETECTION] Error creating replay token:', error)
        }
      }
    }

    // Update user flags if needed
    if (shouldUpdateUser) {
      try {
        await prismaClient.user.update({
          where: { id: user.id },
          data: updateData,
        })
      } catch (error) {
        console.error('[BOT_DETECTION] Error updating user bot flags:', error)
      }
    }

    return { prisma: prismaClient, user, source }
  },
  graphqlEndpoint: '/',
  landingPage: false,
  schema,
})

const server = Bun.serve({
  // This function will handle all HTTP requests
  async fetch(req) {
    try {
      if (!req.url || req.url === undefined || typeof req.url !== 'string') {
        console.error(
          'Request URL is undefined or invalid:',
          req.url,
          typeof req.url,
        )
        return new Response('Bad Request', { status: 400 })
      }
      const url = new URL(req.url)
      const path = url.pathname

      if (path === '/farcaster-webhook' && req.method === 'POST') {
        return handleFarcasterWebhook(req)
      }

      // Handle chicken NFT metadata endpoint
      const chickenRouteMatch = path.match(/^\/chicken-metadata\/(\d+)\.json$/)
      if (chickenRouteMatch && req.method === 'GET') {
        const chickenSerialId = parseInt(chickenRouteMatch[1], 10)

        try {
          const hen = await prismaClient.hen.findUnique({
            where: {
              serialId: chickenSerialId,
            },
            include: {
              user: true,
            },
          })

          if (!hen) {
            return new Response('Chicken not found', { status: 404 })
          }

          // Get owner's highest level chicken
          const ownerMaxLevelHen = await prismaClient.hen.findFirst({
            where: {
              userId: hen.userId,
            },
            orderBy: {
              level: 'desc',
            },
          })

          // Calculate age in days
          const ageInDays = Math.floor(
            (new Date().getTime() - hen.createdAt.getTime()) /
              (1000 * 60 * 60 * 24),
          )

          const { isSybil } = await isUserSybil(hen.user)

          const metadata = {
            name: `${hen.name} #${hen.serialId}`,
            description: `A chicken from the $EGGS ecosystem. Level ${hen.level}.`,
            image: `https://eggs.name/nft/${isSybil ? 'nonlvl' : `lvl${hen.level}`}.png`,
            attributes: [
              {
                trait_type: 'Level',
                value: hen.level,
              },
              {
                trait_type: 'Name',
                value: hen.name,
              },
              {
                trait_type: 'Age (Days)',
                value: ageInDays,
              },
              {
                trait_type: 'Owner Neynar Score',
                value: hen.user.isVerifiedBot ? 0 : hen.user.neynarUserScore,
              },
              {
                trait_type: 'Owner Max Chicken Level',
                value: hen.user.isVerifiedBot
                  ? 0
                  : ownerMaxLevelHen?.level || 0,
              },
              {
                trait_type: '$EGGS coop ID',
                value: hen.user.serialId,
              },
            ],
          }

          return new Response(JSON.stringify(metadata), {
            headers: {
              'Content-Type': 'application/json',
            },
          })
        } catch (error) {
          console.error('Error fetching chicken metadata:', error)
          return new Response('Internal server error', { status: 500 })
        }
      }

      const henRouteMatch = path.match(/^\/og\/hen\/([^\/]+)$/)
      if (henRouteMatch) {
        const henId = henRouteMatch[1]
        try {
          const webStream = await henStatsStream({
            henId,
          })

          return new Response(webStream, {
            headers: {
              'Content-Type': 'image/png',
            },
          })
        } catch {
          const imageData = Bun.file(`${cwd()}/src/og/assets/eggPrices.png`, {})

          return new Response(imageData, {
            headers: {
              'Content-Type': 'image/png',
            },
          })
        }
      }

      // Default to GraphQL handling
      return yoga.fetch(req)
    } catch (error) {
      console.error('❌ Global request error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: req?.url,
        method: req?.method,
        timestamp: new Date().toISOString(),
      })
      return new Response('Internal Server Error', { status: 500 })
    }
  },
  reusePort: true,
  port: 1337,
})

// Graceful shutdown function
const gracefulShutdown = async () => {
  await server.stop()
  await prismaClient.$disconnect()
  process.exit(0)
}

// Listen for termination signals
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)
