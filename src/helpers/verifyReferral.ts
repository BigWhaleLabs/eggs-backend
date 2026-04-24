import { JackpotTicketType, TransactionType } from '@prisma/client'
import { EGGS_REFERRAL_BONUS, JACKPOT_TICKETS_FOR_REFERRAL } from './consts'
import { giveJackpotTickets } from './giveJackpotTickets'
import prismaClient from './prismaClient'

export default async function verifyReferral({
  fid,
}: {
  fid: string | number
}) {
  const unverifiedReferral = await prismaClient.referral.findFirst({
    where: {
      referred: {
        verifications: {
          some: {
            subjectId: `${fid}`,
          },
        },
      },
      verified: false,
    },
  })
  if (unverifiedReferral) {
    await prismaClient.referral.update({
      where: {
        id: unverifiedReferral.id,
      },
      data: {
        verified: true,
      },
    })
    await prismaClient.user.update({
      where: { id: unverifiedReferral.referrerId },
      data: { unclaimedEggs: { increment: EGGS_REFERRAL_BONUS } },
    })
    await prismaClient.eggTransaction.create({
      data: {
        userId: unverifiedReferral.referrerId,
        amount: EGGS_REFERRAL_BONUS,
        type: TransactionType.REFERRAL_REWARD,
      },
    })

    await giveJackpotTickets(
      prismaClient,
      JACKPOT_TICKETS_FOR_REFERRAL,
      unverifiedReferral.referrerId,
      JackpotTicketType.REFERRAL,
    )

    console.log(
      `Created 2 referral jackpot tickets for user ${unverifiedReferral.referrerId}`,
    )
  }
}
