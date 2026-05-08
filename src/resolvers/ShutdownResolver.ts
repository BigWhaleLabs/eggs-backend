import { ethers } from 'ethers'
import { GraphQLError } from 'graphql'
import generateHenMintSignature from 'helpers/generateHenMintSignature'
import { getEggBalances } from 'helpers/getEggBalance'
import { resolveShutdownUser } from 'helpers/shutdownAuth'
import type Context from 'models/Context'
import {
  Arg,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from 'type-graphql'

@ObjectType()
class HenMintSignature {
  @Field()
  message!: string

  @Field()
  signature!: string

  @Field()
  r!: string

  @Field()
  vs!: string
}

@ObjectType()
class ShutdownHen {
  @Field()
  id!: string

  @Field()
  serialId!: number

  @Field()
  name!: string

  @Field()
  level!: number

  @Field({ nullable: true })
  onchainOwnerAddress!: string | null
}

@ObjectType()
class EggStakeBalance {
  @Field()
  walletBalance!: string

  @Field()
  stakedBalance!: string

  @Field()
  totalBalance!: string
}

@Resolver()
export default class ShutdownResolver {
  @Query(() => [ShutdownHen])
  async getMyShutdownHens(
    @Arg('ownerAddress', { nullable: true }) ownerAddress: string | null,
    @Arg('authSignature', { nullable: true }) authSignature: string | null,
    @Ctx() { farcasterFid, prisma, user }: Context,
  ): Promise<ShutdownHen[]> {
    const authorizedUser = await resolveShutdownUser({
      authSignature,
      farcasterFid,
      ownerAddress,
      prisma,
      user,
    })

    return prisma.hen.findMany({
      where: {
        userId: authorizedUser.id,
      },
      orderBy: {
        serialId: 'asc',
      },
      select: {
        id: true,
        level: true,
        name: true,
        onchainOwnerAddress: true,
        serialId: true,
      },
    })
  }

  @Query(() => EggStakeBalance)
  async getEggStakeBalance(
    @Arg('ethAddress') ethAddress: string,
  ): Promise<EggStakeBalance> {
    if (!ethers.isAddress(ethAddress)) {
      throw new GraphQLError('Invalid Ethereum address')
    }

    const { stakedBalance, totalBalance, walletBalance } = await getEggBalances(
      ethAddress as `0x${string}`,
    )

    return {
      stakedBalance: stakedBalance.toString(),
      totalBalance: totalBalance.toString(),
      walletBalance: walletBalance.toString(),
    }
  }

  @Mutation(() => HenMintSignature)
  async getHenMintSignature(
    @Arg('henSerialId') henSerialId: number,
    @Arg('toAddress') toAddress: string,
    @Arg('authSignature', { nullable: true }) authSignature: string | null,
    @Ctx() { farcasterFid, prisma, user }: Context,
  ): Promise<HenMintSignature> {
    if (!ethers.isAddress(toAddress)) {
      throw new GraphQLError('Invalid Ethereum address')
    }

    const normalizedToAddress = ethers.getAddress(toAddress)
    const authorizedUser = await resolveShutdownUser({
      authSignature,
      farcasterFid,
      ownerAddress: normalizedToAddress,
      prisma,
      user,
    })

    const hen = await prisma.hen.findFirst({
      where: {
        serialId: henSerialId,
        userId: authorizedUser.id,
      },
    })

    if (!hen) {
      throw new GraphQLError('Hen not found')
    }

    if (hen.onchainOwnerAddress) {
      throw new GraphQLError('Hen is already on-chain')
    }

    const signatureData = await generateHenMintSignature(
      normalizedToAddress,
      BigInt(henSerialId),
    )

    const { r, yParityAndS } = ethers.Signature.from(signatureData.signature)

    return {
      message: signatureData.message,
      signature: signatureData.signature,
      r,
      vs: yParityAndS,
    }
  }
}
