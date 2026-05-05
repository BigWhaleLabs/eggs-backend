import { ethers } from 'ethers'
import { GraphQLError } from 'graphql'
import generateHenMintSignature from 'helpers/generateHenMintSignature'
import { getEggBalances } from 'helpers/getEggBalance'
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
  @Authorized()
  @Query(() => [ShutdownHen])
  async getMyShutdownHens(
    @Ctx() { prisma, user }: AuthorizedContext,
  ): Promise<ShutdownHen[]> {
    return prisma.hen.findMany({
      where: {
        userId: user.id,
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

  @Authorized()
  @Mutation(() => HenMintSignature)
  async getHenMintSignature(
    @Arg('henSerialId') henSerialId: number,
    @Arg('toAddress') toAddress: string,
    @Ctx() { prisma, user }: AuthorizedContext,
  ): Promise<HenMintSignature> {
    if (!ethers.isAddress(toAddress)) {
      throw new GraphQLError('Invalid Ethereum address')
    }

    const hen = await prisma.hen.findUnique({
      where: {
        serialId: henSerialId,
      },
    })

    if (!hen) {
      throw new GraphQLError('Hen not found')
    }

    if (hen.userId !== user.id) {
      throw new GraphQLError('You do not own this hen')
    }

    const signatureData = await generateHenMintSignature(
      toAddress,
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
