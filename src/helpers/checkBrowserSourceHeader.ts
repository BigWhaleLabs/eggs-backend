import type { PrismaClient, User } from '@prisma/client'

// Type for both PrismaClient and Prisma transaction
type PrismaClientOrTx =
  | PrismaClient
  | Omit<
      PrismaClient,
      '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
    >

/**
 * Checks if the user is using a browser source header and flags them as a bot if not
 * @param user - The user to check
 * @param source - The source header value
 * @param action - Description of the action being performed (for logging)
 * @param prisma - Prisma client or transaction for database operations (optional, for updating user)
 */
export default async function checkBrowserSourceHeader(
  user: User,
  source: string | undefined,
  action: string,
  prisma?: PrismaClientOrTx,
) {
  // Bot detection: Check if source header is missing or not 'browser' (bot indicator)
  if (source !== 'browser') {
    if (!user.noBrowserHeader) {
      console.log(
        `[BOT_DETECTION] 🤖 User ${user.username} missing browser source header during ${action} (source: ${source}), flagging as bot`,
      )

      // Uncomment to enable database flagging
      if (prisma) {
        await prisma.user.update({
          where: { id: user.id },
          data: { noBrowserHeader: true },
        })
      }
    }
  }
}
