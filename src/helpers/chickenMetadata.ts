import type { Hen, User } from '@prisma/client'

const MIN_METADATA_NEYNAR_SCORE = 0.69
const HOLDINGS_SYBIL_BYPASS = 15_000

type ChickenMetadataHen = Pick<Hen, 'createdAt' | 'level' | 'name' | 'serialId'>
type ChickenMetadataUser = Pick<
  User,
  'isVerifiedBot' | 'neynarUserScore' | 'serialId' | 'totalHoldings'
>

export function isChickenMetadataSybil({
  ownerMaxLevel,
  user,
}: {
  ownerMaxLevel: number
  user: ChickenMetadataUser
}) {
  if (user.isVerifiedBot) return true
  if (user.totalHoldings >= HOLDINGS_SYBIL_BYPASS) return false
  if (user.neynarUserScore >= MIN_METADATA_NEYNAR_SCORE) return false
  return ownerMaxLevel < 3
}

export function buildChickenMetadata({
  hen,
  isSybil,
}: {
  hen: ChickenMetadataHen & { user: ChickenMetadataUser }
  isSybil: boolean
}) {
  const ageInDays = Math.floor(
    (Date.now() - hen.createdAt.getTime()) / (1000 * 60 * 60 * 24),
  )

  return {
    name: `${hen.name} #${hen.serialId}`,
    description: `A chicken from the $EGGS ecosystem. Level ${hen.level}.`,
    image: `https://eggs.name/nft/${isSybil ? 'nonlvl' : `lvl${hen.level}`}.png`,
    attributes: [
      {
        trait_type: 'Level',
        value: hen.level,
      },
      {
        trait_type: 'Name',
        value: hen.name,
      },
      {
        trait_type: 'Age (Days)',
        value: ageInDays,
      },
      {
        trait_type: 'Owner Neynar Score',
        value: hen.user.isVerifiedBot ? 0 : hen.user.neynarUserScore,
      },
      {
        trait_type: '$EGGS coop ID',
        value: hen.user.serialId,
      },
    ],
  }
}
