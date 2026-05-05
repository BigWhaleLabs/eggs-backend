import { ethers, Wallet } from 'ethers'
import { bytesToHex } from 'viem'
import env from './env'

const chickensSuperHen = new Wallet(env.CHICKENS_SUPER_HEN_PRIVATE_KEY)

function evenPad(value: string) {
  return value.length % 2 === 0 ? value : `0${value}`
}

function turnIntoBytes(value: bigint) {
  return ethers.getBytes(
    ethers.zeroPadValue(`0x${evenPad(value.toString(16))}`, 32),
  )
}

export default async function generateHenMintSignature(
  toAddress: string,
  henSerialId: bigint,
) {
  const henSerialIdBytes = turnIntoBytes(henSerialId)
  const addressBytes = turnIntoBytes(BigInt(toAddress))

  const message = [...addressBytes, ...henSerialIdBytes]

  const messageHex = bytesToHex(new Uint8Array(message))

  const signature = await chickensSuperHen.signMessage(new Uint8Array(message))

  return {
    message: messageHex,
    signature,
  }
}
