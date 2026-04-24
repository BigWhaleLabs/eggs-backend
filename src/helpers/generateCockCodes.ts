import { faker } from '@faker-js/faker'
import type { Prisma, PrismaClient } from '@prisma/client'
import prismaClient from './prismaClient'

export const MAX_CODE_USES = 3
export const CODE_GENERATION_COOLDOWN = 24 * 60 * 60 * 1000

export function generateUniqueCode() {
  return faker.string.alphanumeric(7).toUpperCase()
}

export async function getOrCreateCockCode(
  prisma: PrismaClient | Prisma.TransactionClient = prismaClient,
  userId: string,
) {
  const now = new Date()

  const existingCode = await prisma.cockCode.findFirst({
    where: {
      userId,
    },
    include: { hens: true },
    orderBy: { createdAt: 'desc' },
  })

  if (existingCode) {
    const isWithin24Hours =
      now.getTime() - existingCode.createdAt.getTime() <
      CODE_GENERATION_COOLDOWN

    if (isWithin24Hours) {
      return existingCode
    }
  }

  const newCode = await prisma.cockCode.create({
    include: {
      hens: true,
    },
    data: {
      code: generateUniqueCode(),
      userId,
    },
  })

  return newCode
}

export async function isValidCockCode(
  prisma: Prisma.TransactionClient,
  code: string | undefined,
) {
  if (!code) {
    return { valid: false, reason: 'Invalid cock code' }
  }

  const cockCode = await prisma.cockCode.findUnique({
    where: { code },
    include: { hens: true },
  })

  if (!cockCode) {
    return { valid: false, reason: 'Invalid cock code' }
  }

  const now = new Date()
  const isExpired =
    now.getTime() - cockCode.createdAt.getTime() >= CODE_GENERATION_COOLDOWN
  if (isExpired) {
    return { valid: false, reason: 'This cock code has expired' }
  }

  if (cockCode.hens.length >= MAX_CODE_USES) {
    return { valid: false, reason: 'This cock code has reached maximum uses' }
  }

  return { valid: true, cockCode }
}
