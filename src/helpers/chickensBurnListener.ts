import type { Prisma } from '@prisma/client'
import { erc721Abi } from 'viem'
import env from './env'
import prismaClient from './prismaClient'
import { createResilientEventListener } from './resilientEventListener'
import { publicClient } from './wallet'

const BURN_REWARD_EGGS = 25

// Function to find user by any of their connected addresses
async function findUserByConnectedAddress(
  address: string,
  tx: Prisma.TransactionClient,
): Promise<{ id: string; username: string } | null> {
  // First try the direct ethAddress match (for backward compatibility)
  const user = await tx.user.findFirst({
    where: {
      ethAddress: address,
    },
    select: {
      id: true,
      username: true,
    },
  })

  if (user) {
    return user
  }

  // If not found, search through connected wallets in verifications
  const verification = await tx.verification.findFirst({
    where: {
      type: 'FARCASTER',
      connectedWallets: {
        some: {
          address: address.toLowerCase(),
        },
      },
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  })

  return verification?.user || null
}

async function processBurnEvent(tokenId: bigint) {
  try {
    await prismaClient.$transaction(async (tx) => {
      // Find the hen by serial ID
      const hen = await tx.hen.findUnique({
        where: {
          serialId: Number(tokenId),
        },
      })

      if (!hen) {
        console.error(
          `[BURN_LISTENER] Hen with serialId ${tokenId} not found for burn event`,
        )
        return
      }

      if (!hen.onchainOwnerAddress) {
        console.error(
          `[BURN_LISTENER] Hen ${tokenId} has no onchain owner address, cannot reward burn`,
        )
        return
      }

      // Find the user who owns this chicken onchain using connected addresses
      const user = await findUserByConnectedAddress(hen.onchainOwnerAddress, tx)

      if (!user) {
        console.log(
          `[BURN_LISTENER] No user found with connected address ${hen.onchainOwnerAddress} for burned chicken ${tokenId}`,
        )
        return
      }

      // Check if we already processed this burn event
      const existingTransaction = await tx.eggTransaction.findFirst({
        where: {
          userId: user.id,
          henId: hen.id,
          type: 'BURN_REWARD',
        },
      })

      if (existingTransaction) {
        console.log(
          `[BURN_LISTENER] Burn reward already processed for chicken ${tokenId}`,
        )
        return
      }

      // Give 25 unclaimed eggs to the user
      await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          unclaimedEggs: {
            increment: BURN_REWARD_EGGS,
          },
        },
      })

      // Create transaction record
      await tx.eggTransaction.create({
        data: {
          userId: user.id,
          amount: BURN_REWARD_EGGS,
          type: 'BURN_REWARD',
          henId: hen.id,
        },
      })

      console.log(
        `Rewarded user ${user.username} with ${BURN_REWARD_EGGS} eggs for burning chicken ${tokenId}`,
      )
    })
  } catch (error) {
    console.error(
      `Error processing chicken burn event for token ${tokenId}:`,
      error,
    )
  }
}

async function processMissedBurnEvents() {
  try {
    console.log('Checking for missed chicken burn events...')

    const currentBlock = await publicClient.getBlockNumber()

    // Get the last processed block from database
    let lastProcessedBlock =
      await prismaClient.chickenBurnProcessedBlock.findFirst()

    if (!lastProcessedBlock) {
      // If no record exists, start from block 34287612
      const startBlock = 34287612n
      lastProcessedBlock = await prismaClient.chickenBurnProcessedBlock.create({
        data: {
          blockNumber: startBlock,
        },
      })
      console.log(`Initialized last processed burn block to ${startBlock}`)
    }

    const fromBlock = lastProcessedBlock.blockNumber + 1n

    if (fromBlock <= currentBlock) {
      console.log(
        `Processing missed burn events from block ${fromBlock} to ${currentBlock}`,
      )

      // Get all Transfer events to burn address from the missed blocks
      const logs = await publicClient.getContractEvents({
        address: env.CHICKENS_CONTRACT_ADDRESS,
        abi: erc721Abi,
        eventName: 'Transfer',
        args: {
          to: '0x0000000000000000000000000000000000000000', // Burn address
        },
        fromBlock,
        toBlock: currentBlock,
      })

      console.log(`Found ${logs.length} missed burn events`)

      // Process each burn event
      for (const log of logs) {
        const { args } = log
        const { tokenId } = args

        if (tokenId) {
          await processBurnEvent(tokenId)
        }
      }

      // Update the last processed block
      await prismaClient.chickenBurnProcessedBlock.update({
        where: {
          id: lastProcessedBlock.id,
        },
        data: {
          blockNumber: currentBlock,
        },
      })

      console.log(`Updated last processed burn block to ${currentBlock}`)
    } else {
      console.log('No missed burn events to process')
    }
  } catch (error) {
    console.error('Error processing missed burn events:', error)
  }
}

export default async function startChickensBurnListener() {
  console.log('Starting Chickens Burn event listener...')

  // First, process any missed burn events
  await processMissedBurnEvents()

  // Then start the real-time listener with auto-recreation on filter errors
  const unwatch = await createResilientEventListener({
    name: 'CHICKEN_BURN',
    createListener: async () => {
      return publicClient.watchContractEvent({
        address: env.CHICKENS_CONTRACT_ADDRESS,
        abi: erc721Abi,
        eventName: 'Transfer',
        args: {
          to: '0x0000000000000000000000000000000000000000', // Burn address
        },
        onLogs: async (logs) => {
          for (const log of logs) {
            try {
              const { args, blockNumber } = log
              const { tokenId } = args

              if (!tokenId) {
                console.error('Missing tokenId in burn Transfer event')
                continue
              }

              await processBurnEvent(tokenId)

              // Update the last processed block
              const existingRecord =
                await prismaClient.chickenBurnProcessedBlock.findFirst()
              if (existingRecord) {
                await prismaClient.chickenBurnProcessedBlock.update({
                  where: {
                    id: existingRecord.id,
                  },
                  data: {
                    blockNumber: BigInt(blockNumber),
                  },
                })
              } else {
                await prismaClient.chickenBurnProcessedBlock.create({
                  data: {
                    blockNumber: BigInt(blockNumber),
                  },
                })
              }
            } catch (error) {
              console.error('Error processing Chickens Burn event:', error)
            }
          }
        },
      })
    },
  })

  console.log('Chickens Burn event listener started')
  return unwatch
}
