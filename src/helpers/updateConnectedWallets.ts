import getConnectedWalletsByFID from './getConnectedWalletsByFID'
import prismaClient from './prismaClient'

const BATCH_SIZE = 10

export default async function updateConnectedWallets() {
  console.log('[CONNECTED_WALLETS] Starting connected wallets update...')

  try {
    // Get all Farcaster verifications
    const verifications = await prismaClient.verification.findMany({
      where: {
        type: 'FARCASTER',
      },
      select: {
        id: true,
        subjectId: true,
        userId: true,
        user: {
          select: {
            username: true,
          },
        },
      },
    })

    console.log(
      `[CONNECTED_WALLETS] Found ${verifications.length} Farcaster verifications to process`,
    )

    let totalProcessed = 0
    let totalWalletsUpdated = 0
    let totalErrors = 0

    // Process in batches of 10
    for (let i = 0; i < verifications.length; i += BATCH_SIZE) {
      const batch = verifications.slice(i, i + BATCH_SIZE)

      // Process each verification in the current batch
      const batchPromises = batch.map(async (verification) => {
        try {
          const fid = parseInt(verification.subjectId)
          if (isNaN(fid)) {
            console.warn(
              `[CONNECTED_WALLETS] Invalid FID: ${verification.subjectId} for user ${verification.user.username}`,
            )
            return { success: false, walletsCount: 0 }
          }

          // Fetch connected wallets from Farcaster
          const connectedWallets = await getConnectedWalletsByFID(fid)

          // Update the database with the current connected wallets
          await prismaClient.$transaction(async (tx) => {
            // Add the current connected wallets
            if (connectedWallets.length > 0) {
              // Remove all existing connected wallets for this verification
              await tx.connectedWallet.deleteMany({
                where: {
                  verificationId: verification.id,
                },
              })
              await tx.connectedWallet.createMany({
                data: connectedWallets.map((address) => ({
                  verificationId: verification.id,
                  address: address.toLowerCase(), // Normalize to lowercase
                  lastVerified: new Date(),
                })),
                skipDuplicates: true,
              })
            }
          })

          return { success: true, walletsCount: connectedWallets.length }
        } catch (error) {
          console.error(
            `[CONNECTED_WALLETS] Error processing FID ${verification.subjectId}:`,
            error,
          )
          return { success: false, walletsCount: 0 }
        }
      })

      // Wait for all promises in the current batch to complete
      const batchResults = await Promise.all(batchPromises)

      // Update counters
      for (const result of batchResults) {
        totalProcessed++
        if (result.success) {
          totalWalletsUpdated += result.walletsCount
        } else {
          totalErrors++
        }
      }
    }

    console.log(`[CONNECTED_WALLETS] Connected wallets update completed:`)
    console.log(
      `[CONNECTED_WALLETS] - Total verifications processed: ${totalProcessed}`,
    )
    console.log(
      `[CONNECTED_WALLETS] - Total wallets updated: ${totalWalletsUpdated}`,
    )
    console.log(`[CONNECTED_WALLETS] - Total errors: ${totalErrors}`)
  } catch (error) {
    console.error('[CONNECTED_WALLETS] Error in updateConnectedWallets:', error)
    throw error
  }
}

// Function to get connected wallets for a specific user or FID
export async function getStoredConnectedWallets(params: {
  userId?: string
  fid?: number
}): Promise<string[]> {
  const { userId, fid } = params

  if (!userId && !fid) {
    throw new Error('Either userId or fid must be provided')
  }

  if (userId && fid) {
    throw new Error('Only one of userId or fid should be provided')
  }

  let whereClause
  if (userId) {
    whereClause = { userId, type: 'FARCASTER' as const }
  } else if (fid) {
    whereClause = { subjectId: fid.toString(), type: 'FARCASTER' as const }
  } else {
    throw new Error('Either userId or fid must be provided')
  }

  const verification = await prismaClient.verification.findFirst({
    where: whereClause,
    include: {
      connectedWallets: {
        select: {
          address: true,
        },
      },
    },
  })

  return verification?.connectedWallets.map((w) => w.address) || []
}

// Backward compatibility exports
export const getStoredConnectedWalletsByUserId = (userId: string) =>
  getStoredConnectedWallets({ userId })

export const getStoredConnectedWalletsByFID = (fid: number) =>
  getStoredConnectedWallets({ fid })
