import { faker } from '@faker-js/faker'
import { Hen } from '@generated/type-graphql/models/Hen'
import { JackpotTicketType, Prisma, TransactionType } from '@prisma/client'
import { ethers } from 'ethers'
import { GraphQLError } from 'graphql'
import {
  EGGS_REFERRAL_BONUS,
  JACKPOT_TICKETS_FOR_REFERRAL,
  MIN_NEYNAR_SCORE,
} from 'helpers/consts'
import { getOrCreateCockCode, isValidCockCode } from 'helpers/generateCockCodes'
import generateHenMintSignature from 'helpers/generateHenMintSignature'
import getConnectedWalletsByFID from 'helpers/getConnectedWalletsByFID'
import { giveJackpotTickets } from 'helpers/giveJackpotTickets'
import { checkIfAirdropUser } from 'helpers/initAirdropUsernames'
import isUserSybil from 'helpers/isUserSybil'
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

@Resolver()
export default class HenResolver {
  @Authorized()
  @Mutation(() => Hen)
  async fertilizeUserHen(
    @Arg('targetUserId') targetUserId: string,
    @Ctx() { prisma, user }: AuthorizedContext,
  ) {
    if (targetUserId === user.id) {
      throw new GraphQLError('You cannot fertilize your own hen')
    }

    return prisma.$transaction(
      async (tx) => {
        const targetUser = await tx.user.findUnique({
          where: { id: targetUserId },
        })

        if (!targetUser) {
          throw new GraphQLError('Target user not found')
        }

        const targetHen = await tx.hen.findFirst({
          where: {
            userId: targetUserId,
          },
        })

        if (!!targetHen) {
          throw new GraphQLError(
            'Target user already has a hen, you cannot fertilize it',
          )
        }

        // Check if target user has ever been the original owner of any chicken
        const originalHen = await tx.hen.findFirst({
          where: {
            originalOwnerId: targetUserId,
          },
        })

        if (!!originalHen) {
          throw new GraphQLError(
            'Target user has already hatched a chicken before, you cannot fertilize them',
          )
        }

        const userCockCode = await getOrCreateCockCode(tx, user.id)

        if (!userCockCode) {
          throw new GraphQLError('You do not have a valid cock code')
        }

        const cockCodeValid = await isValidCockCode(tx, userCockCode?.code)

        if (!cockCodeValid.valid) {
          if (cockCodeValid.reason) throw new GraphQLError(cockCodeValid.reason)
          throw new GraphQLError('You do not have a valid cock code')
        }

        const newHen = await tx.hen.create({
          data: {
            userId: targetUser.id,
            originalOwnerId: targetUser.id, // Set original owner
            name: faker.person.firstName('female'),
            level: 1,
            dailyYield: 1,
            fertilized: true,
            cockCodeId: userCockCode.id,
          },
        })

        if (targetUser.neynarUserScore >= MIN_NEYNAR_SCORE) {
          await tx.user.update({
            where: { id: user.id },
            data: { unclaimedEggs: { increment: EGGS_REFERRAL_BONUS } },
          })
          await tx.eggTransaction.create({
            data: {
              userId: user.id,
              amount: EGGS_REFERRAL_BONUS,
              type: TransactionType.REFERRAL_REWARD,
            },
          })

          await giveJackpotTickets(
            tx,
            JACKPOT_TICKETS_FOR_REFERRAL,
            user.id,
            JackpotTicketType.REFERRAL,
          )
        }

        await tx.referral.upsert({
          where: { referredId: targetUser.id },
          update: {},
          create: {
            referrerId: user.id,
            referredId: targetUser.id,
            rewardAmount: EGGS_REFERRAL_BONUS,
            verified: targetUser.neynarUserScore >= MIN_NEYNAR_SCORE,
          },
        })

        return newHen
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    )
  }

  @Authorized()
  @Mutation(() => Hen)
  async hatchFreeHen(
    @Arg('cockCode', {
      nullable: true,
    })
    cockCode: string | undefined,
    @Ctx() { prisma, user }: AuthorizedContext,
  ) {
    return prisma.$transaction(
      async (tx) => {
        const userHens = await tx.hen.findMany({
          where: {
            userId: user.id,
          },
        })

        if (userHens.length > 0) {
          throw new GraphQLError('You already have a hen!')
        }

        // Check if user has ever been the original owner of any chicken
        const originalHens = await tx.hen.findMany({
          where: {
            originalOwnerId: user.id,
          },
        })

        if (originalHens.length > 0) {
          throw new GraphQLError('You have already hatched a chicken before!')
        }

        const farcasterVerification = await tx.verification.findFirstOrThrow({
          where: {
            userId: user.id,
            type: 'FARCASTER',
          },
        })

        const isAirdropUser = farcasterVerification.subjectId
          ? checkIfAirdropUser(farcasterVerification.subjectId)
          : false

        const cockCodeValid = await isValidCockCode(tx, cockCode)

        if (
          (!cockCodeValid.valid || !cockCodeValid.cockCode?.userId) &&
          !isAirdropUser
        ) {
          if (cockCodeValid.reason) throw new GraphQLError(cockCodeValid.reason)
          throw new GraphQLError('You do not have a valid cock code')
        }

        const cockCodeField = isAirdropUser
          ? {}
          : {
              cockCodeId: cockCodeValid.cockCode?.id,
            }

        const newHen = await tx.hen.create({
          data: {
            userId: user.id,
            originalOwnerId: user.id, // Set original owner
            name: faker.person.firstName('female'),
            level: 1,
            fertilized: true,
            lastFertilized: new Date(),
            dailyYield: 1,
            ...cockCodeField,
          },
        })

        if (
          user.neynarUserScore >= MIN_NEYNAR_SCORE &&
          !isAirdropUser &&
          cockCodeValid.cockCode?.userId
        ) {
          await tx.user.update({
            where: { id: cockCodeValid.cockCode?.userId },
            data: { unclaimedEggs: { increment: EGGS_REFERRAL_BONUS } },
          })
          await tx.eggTransaction.create({
            data: {
              userId: cockCodeValid.cockCode?.userId,
              amount: EGGS_REFERRAL_BONUS,
              type: TransactionType.REFERRAL_REWARD,
            },
          })

          await giveJackpotTickets(
            tx,
            JACKPOT_TICKETS_FOR_REFERRAL,
            cockCodeValid.cockCode?.userId,
            JackpotTicketType.REFERRAL,
          )
        }

        if (!isAirdropUser && cockCodeValid.cockCode?.userId)
          await tx.referral.create({
            data: {
              referrerId: cockCodeValid.cockCode.userId,
              referredId: user.id,
              rewardAmount: EGGS_REFERRAL_BONUS,
              verified: user.neynarUserScore >= MIN_NEYNAR_SCORE,
            },
          })

        return newHen
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    )
  }

  @Authorized()
  @Mutation(() => HenMintSignature)
  async getHenMintSignature(
    @Arg('henSerialId') henSerialId: number,
    @Arg('toAddress') toAddress: string,
    @Ctx() { prisma, user }: AuthorizedContext,
  ): Promise<HenMintSignature> {
    // Find the hen by serial ID and verify ownership
    const hen = await prisma.hen.findUnique({
      where: {
        serialId: henSerialId,
      },
      include: {
        originalOwner: true,
      },
    })

    if (!hen) {
      throw new GraphQLError('Hen not found')
    }

    if (hen.userId !== user.id) {
      throw new GraphQLError('You do not own this hen')
    }

    // Check if the original owner has already minted 3 chickens
    if (hen.originalOwnerId) {
      const mintedChickensCount = await prisma.hen.count({
        where: {
          originalOwnerId: hen.originalOwnerId,
        },
      })

      if (mintedChickensCount >= 3) {
        throw new GraphQLError(
          'You have already minted the maximum of 3 chickens on-chain',
        )
      }
    }

    // Generate the signature
    const signatureData = await generateHenMintSignature(
      toAddress,
      BigInt(henSerialId),
    )

    // Parse the signature to get r and vs components
    const { r, yParityAndS } = ethers.Signature.from(signatureData.signature)

    return {
      message: signatureData.message,
      signature: signatureData.signature,
      r,
      vs: yParityAndS,
    }
  }

  @Authorized()
  @Query(() => [Hen])
  async getOnchainOwnedHens(
    @Ctx() { prisma, user }: AuthorizedContext,
  ): Promise<Hen[]> {
    // Get user's Farcaster verification
    const farcasterVerification = await prisma.verification.findFirst({
      where: {
        userId: user.id,
        type: 'FARCASTER',
      },
    })

    if (!farcasterVerification?.subjectId) {
      throw new GraphQLError('User does not have a Farcaster verification')
    }

    // Get connected wallets from Farcaster
    const connectedWallets = await getConnectedWalletsByFID(
      parseInt(farcasterVerification.subjectId),
    )

    if (!connectedWallets.length) {
      throw new GraphQLError('User does not have any connected wallets')
    }

    // Find hens where onchainOwnerAddress matches any of the user's connected wallets
    // but userId doesn't match the current user
    const hens = await prisma.hen.findMany({
      where: {
        onchainOwnerAddress: {
          in: connectedWallets.map((wallet) => wallet.toLowerCase()),
        },
        userId: {
          not: user.id,
        },
      },
    })

    return hens
  }

  @Authorized()
  @Mutation(() => Hen)
  async claimChickenOwnership(
    @Arg('henSerialId') henSerialId: number,
    @Ctx() { prisma, user }: AuthorizedContext,
  ): Promise<Hen> {
    // Get user's Farcaster verification
    const farcasterVerification = await prisma.verification.findFirst({
      where: {
        userId: user.id,
        type: 'FARCASTER',
      },
    })

    if (!farcasterVerification?.subjectId) {
      throw new GraphQLError('User does not have a Farcaster verification')
    }

    // Get connected wallets from Farcaster
    const connectedWallets = await getConnectedWalletsByFID(
      parseInt(farcasterVerification.subjectId),
    )

    if (!connectedWallets.length) {
      throw new GraphQLError('User does not have any connected wallets')
    }

    return prisma.$transaction(
      async (tx) => {
        // Find the hen by serial ID
        const hen = await tx.hen.findUnique({
          where: {
            serialId: henSerialId,
          },
          include: {
            user: true,
          },
        })

        if (!hen) {
          throw new GraphQLError('Hen not found')
        }

        // Check if user is the onchain owner (check against all connected wallets)
        const userOwnsOnchain =
          hen.onchainOwnerAddress &&
          connectedWallets
            .map((wallet: string) => wallet.toLowerCase())
            .includes(hen.onchainOwnerAddress.toLowerCase())

        if (!userOwnsOnchain) {
          throw new GraphQLError('You do not own this hen on-chain')
        }

        // Check if user is already the database owner
        if (hen.userId === user.id) {
          throw new GraphQLError('You already own this hen in the database')
        }

        // Check if the current database owner is a sybil user
        const sybilCheck = await isUserSybil({
          id: hen.userId,
          prisma: tx,
        })

        if (
          sybilCheck.isSybil &&
          ![89709, 89750, 89751].includes(henSerialId)
        ) {
          const errorMessage = sybilCheck.message
            ? `Cannot transfer ownership from a bot user, they need Neynar score >= ${MIN_NEYNAR_SCORE} or a level 3+ chicken. ${sybilCheck.message}`
            : `Cannot transfer ownership from a bot user, they need Neynar score >= ${MIN_NEYNAR_SCORE} or a level 3+ chicken`
          throw new GraphQLError(errorMessage)
        }

        // Transfer ownership to the onchain owner
        const updatedHen = await tx.hen.update({
          where: {
            id: hen.id,
          },
          data: {
            userId: user.id,
            lastTransferred: new Date(),
            yielding: true, // Resume yielding when properly claimed
          },
        })

        return updatedHen
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    )
  }
}
