import { ethers } from 'ethers'
import { GraphQLError } from 'graphql'
import type { PrismaClient, User } from '@prisma/client'

export function getShutdownAuthorizationMessage(address: string) {
  return [
    'Eggs shutdown authorization',
    '',
    `Wallet: ${ethers.getAddress(address)}`,
  ].join('\n')
}

function assertSignedAddress(ownerAddress: string, authSignature: string) {
  if (!ethers.isAddress(ownerAddress)) {
    throw new GraphQLError('Invalid Ethereum address')
  }

  const normalizedOwnerAddress = ethers.getAddress(ownerAddress)
  let recoveredAddress: string

  try {
    recoveredAddress = ethers.verifyMessage(
      getShutdownAuthorizationMessage(normalizedOwnerAddress),
      authSignature,
    )
  } catch {
    throw new GraphQLError('Invalid wallet signature')
  }

  if (ethers.getAddress(recoveredAddress) !== normalizedOwnerAddress) {
    throw new GraphQLError('Wallet signature does not match address')
  }

  return normalizedOwnerAddress
}

export async function resolveShutdownUser({
  authSignature,
  ownerAddress,
  prisma,
  user,
}: {
  authSignature?: string | null
  ownerAddress?: string | null
  prisma: PrismaClient
  user?: Pick<User, 'id'> | null
}) {
  if (user) return user

  if (!ownerAddress || !authSignature) {
    throw new GraphQLError('Wallet signature required')
  }

  const normalizedOwnerAddress = assertSignedAddress(
    ownerAddress,
    authSignature,
  )

  const matchingUsers = await prisma.user.findMany({
    where: {
      OR: [
        {
          ethAddress: {
            equals: normalizedOwnerAddress,
            mode: 'insensitive',
          },
        },
        {
          verifications: {
            some: {
              connectedWallets: {
                some: {
                  address: {
                    equals: normalizedOwnerAddress,
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
    select: {
      id: true,
    },
    take: 2,
  })

  const uniqueUserIds = [...new Set(matchingUsers.map(({ id }) => id))]

  if (uniqueUserIds.length === 0) {
    throw new GraphQLError('No Eggs user found for this wallet')
  }

  if (uniqueUserIds.length > 1) {
    throw new GraphQLError('Wallet is connected to multiple Eggs users')
  }

  return { id: uniqueUserIds[0] }
}
