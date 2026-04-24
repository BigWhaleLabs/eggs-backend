import { ethers } from 'ethers'
import { GraphQLError } from 'graphql'
import createUpgradeSignature from 'helpers/createUpgradeSignature'
import type { AuthorizedContext } from 'models/Context'
import {
  Arg,
  Authorized,
  Ctx,
  Field,
  Mutation,
  ObjectType,
  Resolver,
} from 'type-graphql'

@ObjectType()
class LevelUpgradeResponse {
  @Field()
  id!: string
  @Field()
  fromLevel!: number
  @Field()
  toLevel!: number
  @Field()
  succeeded!: boolean
  @Field()
  encodedData!: string
  @Field()
  r!: string
  @Field()
  vs!: string
}

@Resolver()
export default class ChickenLevelUpgradeResolver {
  @Authorized()
  @Mutation(() => LevelUpgradeResponse)
  async generateChickenLevelUpgrade(
    @Arg('henSerialId') henSerialId: number,
    @Ctx() { prisma, user }: AuthorizedContext,
  ) {
    return await prisma.$transaction(async (tx) => {
      const hen = await tx.hen.findUnique({
        where: { serialId: henSerialId },
      })

      if (!hen) {
        throw new GraphQLError('Hen not found')
      }

      if (hen.userId !== user.id) {
        throw new GraphQLError('You do not own this hen')
      }

      if (hen.level >= 5) {
        throw new GraphQLError('Hen already at max level')
      }

      const existingUpgrade = await tx.chickenLevelUpgrade.findFirst({
        where: {
          henId: hen.id,
          fromLevel: hen.level,
          used: false,
        },
      })

      if (existingUpgrade) {
        const { signature, message } = await createUpgradeSignature(
          BigInt(hen.serialId),
          BigInt(hen.level),
          BigInt(existingUpgrade.result),
        )

        const { r, yParityAndS } = ethers.Signature.from(signature)

        if (!r || !yParityAndS) {
          throw new GraphQLError('Invalid signature')
        }

        return {
          id: existingUpgrade.id,
          fromLevel: existingUpgrade.fromLevel,
          toLevel: existingUpgrade.toLevel,
          succeeded: existingUpgrade.result === 1,
          encodedData: message,
          r,
          vs: yParityAndS,
        }
      }

      const successChanceByLevel = {
        1: 0.9,
        2: 0.6,
        3: 0.3,
        4: 0.1,
      } as Record<number, number>

      const successChance = successChanceByLevel[hen.level]

      if (!successChance) {
        throw new GraphQLError(`Invalid level for upgrade: ${hen.level}`)
      }
      const success = Math.random() < successChance
      const result = success ? 1 : 0

      const upgrade = await tx.chickenLevelUpgrade.create({
        data: {
          henId: hen.id,
          fromLevel: hen.level,
          toLevel: hen.level + 1,
          result: result,
          used: false,
        },
      })

      const { signature, message } = await createUpgradeSignature(
        BigInt(hen.serialId),
        BigInt(hen.level),
        BigInt(upgrade.result),
      )

      const { r, yParityAndS } = ethers.Signature.from(signature)

      if (!r || !yParityAndS) {
        throw new GraphQLError('Invalid signature')
      }

      return {
        id: upgrade.id,
        fromLevel: upgrade.fromLevel,
        toLevel: upgrade.toLevel,
        succeeded: result === 1,
        encodedData: message,
        r,
        vs: yParityAndS,
      }
    })
  }
}
