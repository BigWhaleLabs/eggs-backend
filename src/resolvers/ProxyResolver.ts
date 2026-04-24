import { Proxy } from '@generated/type-graphql/models/Proxy'
import { ethers } from 'ethers'
import { GraphQLError } from 'graphql'
import type { AuthorizedContext } from 'models/Context'
import {
  Arg,
  Authorized,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from 'type-graphql'

@ObjectType()
class AddProxyResponse {
  @Field()
  success!: boolean

  @Field()
  proxy!: Proxy

  @Field({ nullable: true })
  message?: string
}

@ObjectType()
class RemoveProxyResponse {
  @Field()
  success!: boolean

  @Field({ nullable: true })
  message?: string
}

@Resolver()
export default class ProxyResolver {
  @Authorized()
  @Mutation(() => AddProxyResponse)
  async addProxy(
    @Arg('address') address: string,
    @Ctx() { prisma, user, proxyAddress }: AuthorizedContext,
  ) {
    if (proxyAddress) {
      console.log(
        `[PROXY] User ${user.username} adding proxy via proxy address ${proxyAddress}`,
      )
    }
    // Validate Ethereum address format
    if (!ethers.isAddress(address)) {
      throw new GraphQLError('Invalid Ethereum address format')
    }

    // Normalize address to lowercase for consistency
    const normalizedAddress = address.toLowerCase()

    // Check if this address is already used as a proxy by any user
    const existingProxy = await prisma.proxy.findUnique({
      where: { address: normalizedAddress },
      include: { user: { select: { username: true } } },
    })

    if (existingProxy) {
      throw new GraphQLError(
        `This address is already registered as a proxy by user ${existingProxy.user.username}`,
      )
    }

    // Check if user already has this proxy
    const userExistingProxy = await prisma.proxy.findFirst({
      where: {
        userId: user.id,
        address: normalizedAddress,
      },
    })

    if (userExistingProxy) {
      throw new GraphQLError('You have already added this proxy address')
    }

    // Create the proxy
    const proxy = await prisma.proxy.create({
      data: {
        address: normalizedAddress,
        userId: user.id,
      },
    })

    return {
      success: true,
      proxy,
      message: 'Proxy address added successfully',
    }
  }

  @Authorized()
  @Query(() => [Proxy])
  async getMyProxies(@Ctx() { prisma, user, proxyAddress }: AuthorizedContext) {
    if (proxyAddress) {
      console.log(
        `[PROXY] User ${user.username} getting proxies via proxy address ${proxyAddress}`,
      )
    }
    const proxies = await prisma.proxy.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    return proxies
  }

  @Authorized()
  @Mutation(() => RemoveProxyResponse)
  async removeProxy(
    @Arg('address') address: string,
    @Ctx() { prisma, user, proxyAddress }: AuthorizedContext,
  ) {
    if (proxyAddress) {
      console.log(
        `[PROXY] User ${user.username} removing proxy via proxy address ${proxyAddress}`,
      )
    }
    // Validate Ethereum address format
    if (!ethers.isAddress(address)) {
      throw new GraphQLError('Invalid Ethereum address format')
    }

    // Normalize address to lowercase for consistency
    const normalizedAddress = address.toLowerCase()

    // Find and verify ownership of the proxy
    const proxy = await prisma.proxy.findFirst({
      where: {
        address: normalizedAddress,
        userId: user.id,
      },
    })

    if (!proxy) {
      throw new GraphQLError(
        'Proxy not found or you do not own this proxy address',
      )
    }

    // Delete the proxy
    await prisma.proxy.delete({
      where: { id: proxy.id },
    })

    return {
      success: true,
      message: 'Proxy address removed successfully',
    }
  }
}
