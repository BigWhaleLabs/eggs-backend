import { ethers, Wallet } from 'ethers'
import { bytesToHex } from 'viem'
import env from './env'

export const supenHen = new Wallet(env.SUPER_HEN_PRIVATE_KEY)

export function evenPad(value: string) {
  return value.length % 2 === 0 ? value : `0${value}`
}

export function turnIntoBytes(value: bigint) {
  return ethers.getBytes(
    ethers.zeroPadValue(`0x${evenPad(value.toString(16))}`, 32),
  )
}

export default async function (
  chickenId: bigint,
  chickenLevel: bigint,
  randomNumber: bigint,
) {
  const chickenIdBytes = turnIntoBytes(chickenId)
  const chickenLevelBytes = turnIntoBytes(chickenLevel - 1n)
  const randomNumberBytes = turnIntoBytes(randomNumber)

  const message = [
    ...chickenIdBytes,
    ...chickenLevelBytes,
    ...randomNumberBytes,
  ]

  const messageHex = bytesToHex(new Uint8Array(message))

  const signature = await supenHen.signMessage(new Uint8Array(message))
  return {
    message: messageHex,
    signature,
  }
}
