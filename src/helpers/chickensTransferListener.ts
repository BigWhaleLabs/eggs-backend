import { erc721Abi, zeroAddress } from 'viem'
import env from './env'
import prismaClient from './prismaClient'
import { createResilientEventListener } from './resilientEventListener'
import { publicClient } from './wallet'

async function processTransferEvent(tokenId: bigint, from: string, to: string) {
  if (tokenId > 100000000n) {
    return
  }
  try {
    // Skip if this is a mint (from zero address)
    const isTransfer = from !== zeroAddress

    const updateData: {
      onchainOwnerAddress: string
      yielding?: boolean
    } = {
      onchainOwnerAddress: to.toLowerCase(),
    }

    if (isTransfer) {
      // Get the current hen with its database owner
      const hen = await prismaClient.hen.findUnique({
        where: {
          serialId: Number(tokenId),
        },
        include: {
          user: {
            include: {
              verifications: {
                where: {
                  type: 'FARCASTER',
                },
                select: {
                  subjectId: true,
                },
              },
            },
          },
        },
      })

      if (hen && hen.user.verifications.length > 0) {
        // Get the user's connected wallets from the database
        const connectedWallets = await prismaClient.connectedWallet.findMany({
          where: {
            verification: {
              userId: hen.userId,
              type: 'FARCASTER',
            },
          },
          select: {
            address: true,
          },
        })

        // Check if the recipient address is one of the user's verified addresses
        const isVerifiedRecipient = connectedWallets
          .map((wallet) => wallet.address.toLowerCase())
          .includes(to.toLowerCase())

        // Set yielding based on whether recipient is verified
        updateData.yielding = isVerifiedRecipient

        if (!isVerifiedRecipient) {
          console.log(
            `[CHICKEN_TRANSFER] Hen ${tokenId} transferred to unverified address ${to.toLowerCase()}, marking as non-yielding`,
          )
        } else {
          console.log(
            `[CHICKEN_TRANSFER] Hen ${tokenId} transferred to verified address ${to.toLowerCase()}, keeping as yielding`,
          )
        }
      } else {
        // If we can't find the hen or user, mark as non-yielding for safety
        updateData.yielding = false
        console.log(
          `[CHICKEN_TRANSFER] Hen ${tokenId} owner not found or no Farcaster verification, marking as non-yielding`,
        )
      }
    }

    // Update the hen record
    await prismaClient.hen.update({
      where: {
        serialId: Number(tokenId),
      },
      data: updateData,
    })

    console.log(
      `[CHICKEN_TRANSFER] Updated hen ${tokenId} with new onchain owner: ${to.toLowerCase()}${
        updateData.yielding !== undefined
          ? ` (yielding: ${updateData.yielding})`
          : ''
      }`,
    )
  } catch (error) {
    console.error(`[CHICKEN_TRANSFER] Error updating hen ${tokenId}:`, error)
  }
}

async function syncAllChickenOwners() {
  try {
    console.log('[CHICKEN_TRANSFER] Syncing all chicken onchain owners...')

    const startBlock = 34287612n
    const currentBlock = await publicClient.getBlockNumber()

    console.log(
      `[CHICKEN_TRANSFER] Fetching all transfer events from block ${startBlock} to ${currentBlock}...`,
    )

    // Get all Transfer events from the start block to current block
    const logs = await publicClient.getContractEvents({
      address: env.CHICKENS_CONTRACT_ADDRESS,
      abi: erc721Abi,
      eventName: 'Transfer',
      fromBlock: startBlock,
      toBlock: currentBlock,
    })

    console.log(`[CHICKEN_TRANSFER] Found ${logs.length} total transfer events`)

    // Build a map of serialId -> latest owner info
    const latestOwners = new Map<
      number,
      { owner: string; blockNumber: bigint; logIndex: number }
    >()

    // Process events sequentially to get the latest owner for each chicken
    for (const log of logs) {
      const { args, blockNumber, logIndex } = log
      const { from, tokenId, to } = args

      if (tokenId && to && from) {
        const serialId = Number(tokenId)

        const existingData = latestOwners.get(serialId)

        // Store if this is the first entry or if this event is more recent
        if (
          !existingData ||
          blockNumber > existingData.blockNumber ||
          (blockNumber === existingData.blockNumber &&
            logIndex > existingData.logIndex)
        ) {
          latestOwners.set(serialId, {
            owner: to.toLowerCase(),
            blockNumber,
            logIndex,
          })
        }
      }
    }

    console.log(
      `[CHICKEN_TRANSFER] Found ${latestOwners.size} unique chickens to update`,
    )

    let updatedCount = 0

    // Update each chicken with its latest onchain owner
    for (const [serialId, ownerData] of latestOwners) {
      if (serialId > 100000000) {
        continue
      }
      try {
        // Get the current hen to check if we need to update yielding status
        const hen = await prismaClient.hen.findUnique({
          where: {
            serialId,
          },
          include: {
            user: {
              include: {
                verifications: {
                  where: {
                    type: 'FARCASTER',
                  },
                  select: {
                    subjectId: true,
                  },
                },
              },
            },
          },
        })

        if (!hen) {
          console.log(
            `[CHICKEN_TRANSFER] Hen with serialId ${serialId} not found in database`,
          )
          continue
        }

        const updateData: {
          onchainOwnerAddress: string
          yielding?: boolean
        } = {
          onchainOwnerAddress: ownerData.owner,
        }

        // Check if the owner is a verified address for yielding calculation
        if (hen.user.verifications.length > 0) {
          const connectedWallets = await prismaClient.connectedWallet.findMany({
            where: {
              verification: {
                userId: hen.userId,
                type: 'FARCASTER',
              },
            },
            select: {
              address: true,
            },
          })

          const isVerifiedRecipient = connectedWallets
            .map((wallet) => wallet.address.toLowerCase())
            .includes(ownerData.owner)

          updateData.yielding = isVerifiedRecipient
        } else {
          updateData.yielding = false
        }

        await prismaClient.hen.update({
          where: {
            serialId,
          },
          data: updateData,
        })

        updatedCount++
      } catch (error) {
        console.error(
          `[CHICKEN_TRANSFER] Error updating hen ${serialId}:`,
          error,
        )
      }
    }

    console.log(
      `[CHICKEN_TRANSFER] Successfully updated ${updatedCount} chicken owners`,
    )
  } catch (error) {
    console.error('[CHICKEN_TRANSFER] Error syncing chicken owners:', error)
  }
}

async function processMissedTransfers() {
  try {
    console.log('[CHICKEN_TRANSFER] Checking for missed chicken transfers...')

    const currentBlock = await publicClient.getBlockNumber()

    // Get the last processed block from database
    let lastProcessedBlock =
      await prismaClient.chickenTransferProcessedBlock.findFirst()

    if (!lastProcessedBlock) {
      // If no record exists, start from block 34287612
      const startBlock = 34287612n
      lastProcessedBlock =
        await prismaClient.chickenTransferProcessedBlock.create({
          data: {
            blockNumber: startBlock,
          },
        })
      console.log(
        `[CHICKEN_TRANSFER] Initialized last processed block to ${startBlock}`,
      )
    }

    const fromBlock = lastProcessedBlock.blockNumber + 1n

    if (fromBlock <= currentBlock) {
      console.log(
        `Processing missed transfers from block ${fromBlock} to ${currentBlock}`,
      )

      // Get all Transfer events from the missed blocks
      const logs = await publicClient.getContractEvents({
        address: env.CHICKENS_CONTRACT_ADDRESS,
        abi: erc721Abi,
        eventName: 'Transfer',
        fromBlock,
        toBlock: currentBlock,
      })

      console.log(`Found ${logs.length} missed transfer events`)

      // Process each transfer event
      for (const log of logs) {
        const { args } = log
        const { from, tokenId, to } = args

        if (tokenId && to && from) {
          await processTransferEvent(tokenId, from, to)
        }
      }

      // Update the last processed block
      await prismaClient.chickenTransferProcessedBlock.update({
        where: {
          id: lastProcessedBlock.id,
        },
        data: {
          blockNumber: currentBlock,
        },
      })

      console.log(`Updated last processed block to ${currentBlock}`)
    } else {
      console.log('No missed transfers to process')
    }
  } catch (error) {
    console.error('Error processing missed transfers:', error)
  }
}

export default async function startChickensTransferListener() {
  console.log('Starting Chickens Transfer event listener...')

  // First, sync all chicken owners from blockchain events
  await syncAllChickenOwners()

  // Then, process any missed transfers since last processed block
  await processMissedTransfers()

  // Finally, start the real-time listener with auto-recreation on filter errors
  const unwatch = await createResilientEventListener({
    name: 'CHICKEN_TRANSFER',
    createListener: async () => {
      return publicClient.watchContractEvent({
        address: env.CHICKENS_CONTRACT_ADDRESS,
        abi: erc721Abi,
        eventName: 'Transfer',
        onLogs: async (logs) => {
          for (const log of logs) {
            try {
              const { args, blockNumber } = log
              const { from, tokenId, to } = args

              if (!tokenId || !to || !from) {
                console.error(
                  'Missing tokenId, from, or to address in Transfer event',
                )
                continue
              }

              await processTransferEvent(tokenId, from, to)

              // Update the last processed block
              const existingRecord =
                await prismaClient.chickenTransferProcessedBlock.findFirst()
              if (existingRecord) {
                await prismaClient.chickenTransferProcessedBlock.update({
                  where: {
                    id: existingRecord.id,
                  },
                  data: {
                    blockNumber: BigInt(blockNumber),
                  },
                })
              } else {
                await prismaClient.chickenTransferProcessedBlock.create({
                  data: {
                    blockNumber: BigInt(blockNumber),
                  },
                })
              }
            } catch (error) {
              console.error('Error processing Chickens Transfer event:', error)
            }
          }
        },
      })
    },
  })

  console.log('Chickens Transfer event listener started')
  return unwatch
}
