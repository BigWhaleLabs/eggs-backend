import prismaClient from './prismaClient'

/**
 * Get users eligible for balance/stake checks.
 * A user is eligible if they have:
 * - At least one egg claim coupon (indicating they've claimed eggs at least once)
 *
 * Only returns users with connected wallets.
 */
export default async function getEligibleUsers() {
  console.log('[ELIGIBLE_USERS] Finding users with at least one egg claim...')

  // Get users with connected wallets who have at least one egg claim coupon
  const eligibleUsers = await prismaClient.user.findMany({
    where: {
      verifications: {
        some: {
          connectedWallets: {
            some: {},
          },
        },
      },
      coupons: {
        some: {},
      },
    },
    select: {
      id: true,
      username: true,
      verifications: {
        select: {
          type: true,
          subjectId: true,
          connectedWallets: {
            select: {
              address: true,
            },
          },
        },
      },
    },
  })

  console.log(
    `[ELIGIBLE_USERS] Found ${eligibleUsers.length} eligible users (with at least one egg claim)`,
  )

  return eligibleUsers
}
