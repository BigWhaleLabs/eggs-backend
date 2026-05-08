import 'reflect-metadata'

import {
  Errors,
  createClient as createQuickAuthClient,
} from '@farcaster/quick-auth'
import { createYoga, type YogaInitialContext } from 'graphql-yoga'
import {
  buildChickenMetadata,
  isChickenMetadataSybil,
} from 'helpers/chickenMetadata'
import env from 'helpers/env'
import { verifyAuthToken } from 'helpers/jwt'
import prismaClient from 'helpers/prismaClient'
import type Context from 'models/Context'
import ShutdownResolver from 'resolvers/ShutdownResolver'
import { buildSchema } from 'type-graphql'

const quickAuthClient = createQuickAuthClient()

const schema = await buildSchema({
  authChecker: ({ context }: { context: Context }, roles: string[]) => {
    return roles.length === 0 && !!context.user
  },
  resolvers: [ShutdownResolver],
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
    }
  }) => {
    const token: string | undefined =
      request?.headers.get('authorization') || connectionParams?.authorization

    if (!token) return { farcasterFid: null, prisma: prismaClient, user: null }

    if (token.startsWith('Bearer ')) {
      try {
        const payload = await quickAuthClient.verifyJwt({
          domain: env.FARCASTER_QUICK_AUTH_DOMAIN,
          token: token.slice('Bearer '.length),
        })

        const user = await prismaClient.user.findFirst({
          where: {
            verifications: {
              some: {
                subjectId: String(payload.sub),
                type: 'FARCASTER',
              },
            },
          },
        })

        return {
          farcasterFid: payload.sub,
          prisma: prismaClient,
          user,
        }
      } catch (error) {
        if (!(error instanceof Errors.InvalidTokenError)) {
          console.error('Farcaster Quick Auth verification failed', error)
        }

        return { farcasterFid: null, prisma: prismaClient, user: null }
      }
    }

    try {
      verifyAuthToken(token)
    } catch {
      return { farcasterFid: null, prisma: prismaClient, user: null }
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

    return { farcasterFid: null, prisma: prismaClient, user }
  },
  graphqlEndpoint: '/',
  landingPage: false,
  schema,
})

const server = Bun.serve({
  async fetch(req) {
    try {
      if (!req.url || typeof req.url !== 'string') {
        return new Response('Bad Request', { status: 400 })
      }

      const { pathname } = new URL(req.url)
      const chickenRouteMatch = pathname.match(
        /^\/chicken-metadata\/(\d+)\.json$/,
      )

      if (chickenRouteMatch && req.method === 'GET') {
        const chickenSerialId = Number.parseInt(chickenRouteMatch[1], 10)

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

        const ownerMaxLevelHen = await prismaClient.hen.findFirst({
          where: {
            userId: hen.userId,
          },
          orderBy: {
            level: 'desc',
          },
        })

        const isSybil = isChickenMetadataSybil({
          ownerMaxLevel: ownerMaxLevelHen?.level || 0,
          user: hen.user,
        })

        return Response.json(buildChickenMetadata({ hen, isSybil }))
      }

      return yoga.fetch(req)
    } catch (error) {
      console.error('Global request error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: req?.url,
        method: req?.method,
        timestamp: new Date().toISOString(),
      })
      return new Response('Internal Server Error', { status: 500 })
    }
  },
  port: env.PORT,
  reusePort: true,
})

const gracefulShutdown = async () => {
  await server.stop()
  await prismaClient.$disconnect()
  process.exit(0)
}

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)
