import { ethers } from 'ethers'

/**
 * Verifies an EVM signature and returns the signer address
 * @param message The message that was signed
 * @param signature The signature to verify
 * @returns The address that signed the message, or null if invalid
 */
export function verifyEvmSignature(
  message: string,
  signature: string,
): string | null {
  try {
    // Recover the address from the signature
    const recoveredAddress = ethers.verifyMessage(message, signature)

    // Validate that the recovered address is a valid Ethereum address
    if (!ethers.isAddress(recoveredAddress)) {
      return null
    }

    return recoveredAddress.toLowerCase()
  } catch (error) {
    console.error('Error verifying EVM signature:', error)
    return null
  }
}

/**
 * The standard message that proxy addresses must sign for authorization
 */
export const PROXY_AUTH_MESSAGE = 'pigeon calling!'
