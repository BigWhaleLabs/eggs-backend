import { Wallet } from 'ethers'
import { bytesToHex } from 'viem'
import { turnIntoBytes } from './createUpgradeSignature'
import env from './env'

const chickensSuperHen = new Wallet(env.CHICKENS_SUPER_HEN_PRIVATE_KEY)

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
