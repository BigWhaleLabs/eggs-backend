import eggsContractAbi from './eggsContractAbi'
import env from './env'
import { ownerWallet, publicClient } from './wallet'

export async function openJackpotClaims() {
  const txHash = await ownerWallet.writeContract({
    address: env.EGGS_CONTRACT_ADDRESS,
    abi: eggsContractAbi,
    functionName: 'setJackpotClaimsOpen',
    args: [true],
  })

  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 2,
  })
}

export async function closeJackpotClaims() {
  const txHash = await ownerWallet.writeContract({
    address: env.EGGS_CONTRACT_ADDRESS,
    abi: eggsContractAbi,
    functionName: 'setJackpotClaimsOpen',
    args: [false],
  })

  await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 2,
  })
}
