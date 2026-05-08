import 'reflect-metadata'

import { describe, expect, test } from 'bun:test'
import { Wallet } from 'ethers'
import { parse, validate } from 'graphql'
import {
  buildChickenMetadata,
  isChickenMetadataSybil,
} from 'helpers/chickenMetadata'
import { getShutdownAuthorizationMessage } from 'helpers/shutdownAuth'
import { buildSchema } from 'type-graphql'

process.env.BASE_RPC_URL = 'http://127.0.0.1:8545'
process.env.CHICKENS_SUPER_HEN_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000001'
process.env.EGGS_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001'
process.env.JWT_SECRET = 'test-secret'
process.env.POSTGRES = 'postgresql://test:test@127.0.0.1:5432/test'

const removedQueries = [
  'getBurnedEggsAmount',
  'getCurrentEmission',
  'getLeaderboard',
  'getMyCockCode',
  'getMyUnclaimedCoupons',
  'unclaimedJackpotCoupons',
  'verifiedBots',
]

const removedMutations = [
  'claimAllEggs',
  'claimChickenOwnership',
  'claimJackpotTickets',
  'fertilizeUserHen',
  'generateChickenLevelUpgrade',
  'hatchFreeHen',
  'loginWithPrivy',
]

describe('shutdown GraphQL surface', () => {
  test('exposes only shutdown operations', async () => {
    const { default: ShutdownResolver } = await import(
      'resolvers/ShutdownResolver'
    )
    const schema = await buildSchema({
      authChecker: () => true,
      resolvers: [ShutdownResolver],
      validate: false,
    })

    const queryFields = schema.getQueryType()?.getFields() || {}
    const mutationFields = schema.getMutationType()?.getFields() || {}

    expect(Object.keys(queryFields).sort()).toEqual([
      'getEggStakeBalance',
      'getMyShutdownHens',
    ])
    expect(Object.keys(mutationFields).sort()).toEqual(['getHenMintSignature'])
    expect(queryFields.getMyShutdownHens.args.map((arg) => arg.name)).toEqual([
      'authSignature',
      'ownerAddress',
    ])

    for (const query of removedQueries) {
      expect(queryFields[query]).toBeUndefined()
    }

    for (const mutation of removedMutations) {
      expect(mutationFields[mutation]).toBeUndefined()
    }
  })

  test('accepts the frontend shutdown hens query shape', async () => {
    const { default: ShutdownResolver } = await import(
      'resolvers/ShutdownResolver'
    )
    const schema = await buildSchema({
      authChecker: () => true,
      resolvers: [ShutdownResolver],
      validate: false,
    })

    const errors = validate(
      schema,
      parse(`
        query getMyShutdownHens($ownerAddress: String) {
          getMyShutdownHens(ownerAddress: $ownerAddress, authSignature: "0xabc") {
            id
            serialId
            name
            level
            onchainOwnerAddress
          }
        }
      `),
    )

    expect(errors).toEqual([])
  })

  test('looks up shutdown hens through a signed connected wallet', async () => {
    const { default: ShutdownResolver } = await import(
      'resolvers/ShutdownResolver'
    )
    const wallet = Wallet.createRandom()
    const ownerAddress = wallet.address
    const authSignature = await wallet.signMessage(
      getShutdownAuthorizationMessage(ownerAddress),
    )
    let findUsersArgs: unknown
    let findManyArgs: unknown

    await new ShutdownResolver().getMyShutdownHens(
      ownerAddress,
      authSignature,
      {
        prisma: {
          user: {
            findMany: async (args: unknown) => {
              findUsersArgs = args
              return [{ id: 'user-1' }]
            },
          },
          hen: {
            findMany: async (args: unknown) => {
              findManyArgs = args
              return []
            },
          },
        },
        user: null,
      } as never,
    )

    expect(findUsersArgs).toEqual({
      select: {
        id: true,
      },
      take: 2,
      where: {
        OR: [
          {
            ethAddress: {
              equals: ownerAddress,
              mode: 'insensitive',
            },
          },
          {
            verifications: {
              some: {
                connectedWallets: {
                  some: {
                    address: {
                      equals: ownerAddress,
                      mode: 'insensitive',
                    },
                  },
                },
                type: 'FARCASTER',
              },
            },
          },
        ],
      },
    })
    expect(findManyArgs).toEqual({
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
      where: {
        userId: 'user-1',
      },
    })
  })

  test('issues mint signatures only for hens owned by the signed wallet user', async () => {
    const { default: ShutdownResolver } = await import(
      'resolvers/ShutdownResolver'
    )
    const wallet = Wallet.createRandom()
    const ownerAddress = wallet.address
    const authSignature = await wallet.signMessage(
      getShutdownAuthorizationMessage(ownerAddress),
    )
    let findFirstArgs: unknown

    const signature = await new ShutdownResolver().getHenMintSignature(
      42,
      ownerAddress,
      authSignature,
      {
        prisma: {
          user: {
            findMany: async () => [{ id: 'user-1' }],
          },
          hen: {
            findFirst: async (args: unknown) => {
              findFirstArgs = args
              return {
                id: 'hen-1',
                onchainOwnerAddress: null,
                userId: 'user-1',
              }
            },
          },
        },
        user: null,
      } as never,
    )

    expect(findFirstArgs).toEqual({
      where: {
        serialId: 42,
        userId: 'user-1',
      },
    })
    expect(signature.message.startsWith('0x')).toBe(true)
    expect(signature.signature.startsWith('0x')).toBe(true)
  })

  test('rejects mint signatures for another user hen', async () => {
    const { default: ShutdownResolver } = await import(
      'resolvers/ShutdownResolver'
    )
    const wallet = Wallet.createRandom()
    const authSignature = await wallet.signMessage(
      getShutdownAuthorizationMessage(wallet.address),
    )

    await expect(
      new ShutdownResolver().getHenMintSignature(
        42,
        wallet.address,
        authSignature,
        {
          prisma: {
            user: {
              findMany: async () => [{ id: 'user-1' }],
            },
            hen: {
              findFirst: async () => null,
            },
          },
          user: null,
        } as never,
      ),
    ).rejects.toThrow('Hen not found')
  })

  test('rejects wallet queries without a valid signature', async () => {
    const { default: ShutdownResolver } = await import(
      'resolvers/ShutdownResolver'
    )

    await expect(
      new ShutdownResolver().getMyShutdownHens(
        '0x1111111111111111111111111111111111111111',
        null,
        {
          prisma: {},
          user: null,
        } as never,
      ),
    ).rejects.toThrow('Wallet signature required')
  })
})

describe('chicken NFT metadata', () => {
  test('builds retained chicken NFT metadata without economy claim fields', () => {
    const metadata = buildChickenMetadata({
      hen: {
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        level: 4,
        name: 'Ada',
        serialId: 123,
        user: {
          isVerifiedBot: false,
          neynarUserScore: 0.7,
          serialId: 42,
          totalHoldings: 0,
        },
      },
      isSybil: false,
    })

    expect(metadata.name).toBe('Ada #123')
    expect(metadata.image).toBe('https://eggs.name/nft/lvl4.png')
    expect(
      metadata.attributes.map((attribute) => attribute.trait_type),
    ).toEqual([
      'Level',
      'Name',
      'Age (Days)',
      'Owner Neynar Score',
      '$EGGS coop ID',
    ])
  })

  test('keeps sybil chickens on the non-level image', () => {
    expect(
      isChickenMetadataSybil({
        ownerMaxLevel: 1,
        user: {
          isVerifiedBot: true,
          neynarUserScore: 1,
          serialId: 1,
          totalHoldings: 100_000,
        },
      }),
    ).toBe(true)
  })
})
