import type { Wallet } from 'ethers'
import { bytesToHex, parseUnits } from 'viem'
import { supenHen, turnIntoBytes } from './createUpgradeSignature'

export default async function generateClaimCoupon(
  ticketId: bigint,
  ethAddress: string,
  amount: number,
  differentSuperHen?: Wallet,
) {
  const amountBigInt = parseUnits(amount.toString(), 18)

  const ticketType = BigInt(1)

  const addressBytes = turnIntoBytes(BigInt(ethAddress))
  const ticketTypeBytes = turnIntoBytes(ticketType)
  const amountBytes = turnIntoBytes(amountBigInt)
  const ticketIdBytes = turnIntoBytes(ticketId)

  const message = [
    ...addressBytes,
    ...ticketTypeBytes,
    ...amountBytes,
    ...ticketIdBytes,
  ]

  const messageHex = bytesToHex(new Uint8Array(message))

  const signature = await (differentSuperHen || supenHen).signMessage(
    new Uint8Array(message),
  )

  return {
    message: messageHex,
    signature,
  }
}

export async function generateJackpotTicketsClaimCoupon({
  ticketId,
  userId,
  jackpotId,
  numberOfTickets,
}: {
  ticketId: bigint
  userId: number
  jackpotId: bigint
  numberOfTickets: number
}) {
  const userBytes = turnIntoBytes(BigInt(userId))
  const ticketIdBytes = turnIntoBytes(ticketId)
  const jackpotIdBytes = turnIntoBytes(jackpotId)
  const numberOfTicketsBytes = turnIntoBytes(BigInt(numberOfTickets))
  const message = [
    ...userBytes,
    ...ticketIdBytes,
    ...jackpotIdBytes,
    ...numberOfTicketsBytes,
  ]

  const messageHex = bytesToHex(new Uint8Array(message))

  const signature = await supenHen.signMessage(new Uint8Array(message))

  return {
    message: messageHex,
    signature,
  }
}
