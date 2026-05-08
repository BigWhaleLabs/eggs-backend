import { PrismaClient, type User } from '@prisma/client'
import { type YogaInitialContext } from 'graphql-yoga'

export default interface Context extends YogaInitialContext {
  farcasterFid: number | null
  user: User | null
  prisma: PrismaClient
}

export interface AuthorizedContext extends Context {
  user: User
}
