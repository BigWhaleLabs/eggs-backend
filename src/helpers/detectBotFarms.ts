import prismaClient from './prismaClient'

interface AddressGroup {
  address: string
  eggCouponUsers: string[]
  jackpotCouponUsers: string[]
  allUsers: Set<string>
}

// Protected FIDs that should never be marked as bots
const PROTECTED_FIDS = ['271713', '509273', '455666', '882532', '8083']

export default async function detectBotFarms() {
  try {
    console.log('[BOT_DETECTION] 🕵️ Starting bot farm detection...')

    // Get all unique addresses from both coupon types
    const [eggCoupons, jackpotCoupons] = await Promise.all([
      prismaClient.eggClaimCoupon.findMany({
        select: {
          address: true,
          userId: true,
        },
        distinct: ['address', 'userId'],
      }),
      prismaClient.jackpotTicketClaimCoupon.findMany({
        select: {
          address: true,
          userId: true,
        },
        distinct: ['address', 'userId'],
      }),
    ])

    console.log(
      `[BOT_DETECTION] 📊 Found ${eggCoupons.length} unique egg coupon address-user pairs and ${jackpotCoupons.length} jackpot coupon address-user pairs`,
    )

    // Group users by address
    const addressGroups = new Map<string, AddressGroup>()

    // Process egg coupons
    for (const coupon of eggCoupons) {
      if (!addressGroups.has(coupon.address)) {
        addressGroups.set(coupon.address, {
          address: coupon.address,
          eggCouponUsers: [],
          jackpotCouponUsers: [],
          allUsers: new Set(),
        })
      }
      const group = addressGroups.get(coupon.address)
      if (group && !group.eggCouponUsers.includes(coupon.userId)) {
        group.eggCouponUsers.push(coupon.userId)
        group.allUsers.add(coupon.userId)
      }
    }

    // Process jackpot coupons
    for (const coupon of jackpotCoupons) {
      if (!addressGroups.has(coupon.address)) {
        addressGroups.set(coupon.address, {
          address: coupon.address,
          eggCouponUsers: [],
          jackpotCouponUsers: [],
          allUsers: new Set(),
        })
      }
      const group = addressGroups.get(coupon.address)
      if (group && !group.jackpotCouponUsers.includes(coupon.userId)) {
        group.jackpotCouponUsers.push(coupon.userId)
        group.allUsers.add(coupon.userId)
      }
    }

    // Filter addresses with 3 or more unique users
    const suspiciousAddresses = Array.from(addressGroups.values()).filter(
      (group) => group.allUsers.size >= 3,
    )

    console.log(
      `[BOT_DETECTION] 🚨 Found ${suspiciousAddresses.length} suspicious addresses with 3+ users`,
    )

    let totalUsersMarked = 0
    let alreadyMarkedCount = 0

    for (const group of suspiciousAddresses) {
      const userIds = Array.from(group.allUsers)

      // Check which users are not already marked as bots
      const users = await prismaClient.user.findMany({
        where: {
          id: { in: userIds },
        },
        select: {
          id: true,
          isVerifiedBot: true,
          username: true,
          verifications: {
            where: {
              type: 'FARCASTER',
            },
            select: {
              subjectId: true,
            },
          },
        },
      })

      // Filter out users that are already marked as bots or have protected FID
      const unmarkedUsers = users.filter((user) => {
        // Skip if already marked as bot
        if (user.isVerifiedBot) return false

        // Skip if user has any protected FID
        const hasProtectedFid = user.verifications.some((verification) =>
          PROTECTED_FIDS.includes(verification.subjectId),
        )
        if (hasProtectedFid) {
          return false
        }

        return true
      })
      alreadyMarkedCount += users.length - unmarkedUsers.length

      if (unmarkedUsers.length === 0) {
        continue
      }

      // Determine the appropriate comment based on coupon types
      let comment: string
      const hasEggCoupons = group.eggCouponUsers.length > 0
      const hasJackpotCoupons = group.jackpotCouponUsers.length > 0

      if (hasEggCoupons && hasJackpotCoupons) {
        comment = 'claimed eggs and jackpot tickets from the same address'
      } else if (hasEggCoupons) {
        comment = 'claimed eggs from the same address'
      } else {
        comment = 'claimed jackpot tickets from the same address'
      }

      // Mark all users for this address as bots
      await prismaClient.user.updateMany({
        where: {
          id: { in: unmarkedUsers.map((u) => u.id) },
        },
        data: {
          isVerifiedBot: true,
          botVerificationComment: comment,
        },
      })

      totalUsersMarked += unmarkedUsers.length

      console.log(
        `[BOT_DETECTION] 🤖 Address ${group.address}: Marked ${unmarkedUsers.length} users as bots (${group.eggCouponUsers.length} egg, ${group.jackpotCouponUsers.length} jackpot users) - "${comment}"`,
      )
    }

    const summary = {
      addressesScanned: addressGroups.size,
      suspiciousAddresses: suspiciousAddresses.length,
      usersMarked: totalUsersMarked,
      alreadyMarked: alreadyMarkedCount,
    }

    console.log(
      `[BOT_DETECTION] 🎉 Bot detection complete:\n` +
        `  📍 Addresses scanned: ${summary.addressesScanned}\n` +
        `  🚨 Suspicious addresses found: ${summary.suspiciousAddresses}\n` +
        `  🤖 Users newly marked as bots: ${summary.usersMarked}\n` +
        `  ✅ Users already marked: ${summary.alreadyMarked}`,
    )

    return summary
  } catch (error) {
    console.error('[BOT_DETECTION] ❌ Error in bot farm detection:', error)
    throw error
  }
}
