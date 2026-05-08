import 'reflect-metadata'

import { describe, expect, test } from 'bun:test'
import { parse, validate } from 'graphql'
import {
  buildChickenMetadata,
  isChickenMetadataSybil,
} from 'helpers/chickenMetadata'
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
          getMyShutdownHens(ownerAddress: $ownerAddress) {
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
