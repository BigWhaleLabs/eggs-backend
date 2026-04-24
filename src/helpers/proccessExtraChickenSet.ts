import { faker } from '@faker-js/faker'
import { HEN_MAX_COUNT } from './consts'
import prismaClient from './prismaClient'

export default async function proccessExtraChickenSet(
  serialUserId: number,
  totalOnchainChickens: number,
) {
  return await prismaClient.$transaction(async (prisma) => {
    const user = await prisma.user.findUniqueOrThrow({
      include: {
        hens: true,
      },
      where: {
        serialId: serialUserId,
      },
    })

    const adjustedTotalChickens = totalOnchainChickens + 1

    if (
      user.hens.length >= adjustedTotalChickens ||
      user.hens.length >= HEN_MAX_COUNT
    ) {
      return 0
    }

    const newHensCount = Math.min(
      adjustedTotalChickens - user.hens.length,
      HEN_MAX_COUNT - user.hens.length,
    )

    const hensData = Array.from({ length: newHensCount }, () => ({
      userId: user.id,
      name: faker.person.firstName('female'),
      level: 1,
      dailyYield: 1,
      fertilized: true,
      originalOwnerId: user.id,
    }))

    await prisma.hen.createMany({
      data: hensData,
    })

    return newHensCount
  })
}
