import { generateRandomName } from '@big-whale-labs/backend-utils'
import { User } from '@generated/type-graphql/models/User'
import { VerificationType } from '@prisma/client'
import { GraphQLError } from 'graphql'
import { getOrCreateCockCode } from 'helpers/generateCockCodes'
import neynarApiService from 'helpers/neynarApiService'
import { getAuthToken } from 'helpers/jwt'
import privy from 'helpers/privy'
import reportToDiscord from 'helpers/reportToDiscord'
import type Context from 'models/Context'
import {
  Args,
  ArgsType,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Resolver,
} from 'type-graphql'

@ArgsType()
class LoginParams {
  @Field()
  token!: string
}

@ObjectType()
class LoginResponse {
  @Field()
  token!: string
  @Field()
  user!: User
}

@Resolver()
export default class LoginResolver {
  @Mutation(() => LoginResponse)
  async loginWithPrivy(
    @Args()
    { token }: LoginParams,
    @Ctx() { prisma, req }: Context,
  ) {
    // Get user
    const verifiedToken = await privy.verifyAuthToken(token)
    const { farcaster, wallet } = await privy.getUserById(verifiedToken.userId)

    if (!farcaster) throw new GraphQLError('No social data provided')

    const avatar = farcaster?.pfp || null
    const subjectId = farcaster?.fid ? `${farcaster.fid}` : null
    if (!subjectId) {
      throw new GraphQLError('No subjectId from Privy provided')
    }

    // See if it's a login
    const user = await prisma.user.findUnique({
      where: {
        privyUserId: verifiedToken.userId,
      },
    })

    if (user) {
      const authToken = await prisma.authToken.create({
        data: {
          token: getAuthToken(user),
          userAgent: req?.headers?.['user-agent'] || 'Unknown',
          userId: user.id,
        },
      })
      await prisma.verification.update({
        data: {
          avatar,
        },
        where: {
          subjectId,
        },
      })
      return {
        token: authToken.token,
        user,
      }
    }

    try {
      const newUser = await prisma.$transaction(async (tx) => {
        let username =
          farcaster?.username ||
          generateRandomName(
            wallet?.address || `${farcaster?.fid}` || `${Math.random()}`,
          )
        if (!username) {
          throw new GraphQLError('No username provided')
        }
        const existingUser = await tx.user.findFirst({
          where: {
            username,
          },
        })
        if (existingUser) {
          username = `${username}${Math.floor(Math.random() * 1000)}`
        }
        let neynarUserScore = 0
        if (farcaster.fid) {
          try {
            const neynarUser = await neynarApiService.getUser(farcaster.fid)
            if (neynarUser) {
              neynarUserScore = neynarUser.score
            }
          } catch (error) {
            console.error('Error fetching Neynar user score on signup:', error)
          }
        }
        const user = await tx.user.create({
          data: {
            ethAddress: wallet?.address,
            privyUserId: verifiedToken.userId,
            username,
            neynarUserScore,
            verifications: {
              create: {
                avatar,
                subjectId,
                type: VerificationType.FARCASTER,
                username: farcaster?.username || null,
              },
            },
          },
        })

        const expiresAt = new Date()
        expiresAt.setHours(expiresAt.getHours() + 24)

        await getOrCreateCockCode(tx, user.id)

        return user
      })
      void reportToDiscord(`New user: https://warpcast.com/${newUser.username}`)
      const authToken = await prisma.authToken.create({
        data: {
          token: getAuthToken(newUser),
          userAgent: req?.headers?.['user-agent'] || 'Unknown',
          userId: newUser.id,
        },
      })
      return {
        token: authToken.token,
        user: newUser,
      }
    } catch (error) {
      console.error('Error creating user with deposit addresses:', error)
      throw new GraphQLError('Failed to create user account')
    }
  }
}
