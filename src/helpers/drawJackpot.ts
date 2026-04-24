import eggsContractAbi from './eggsContractAbi'
import env from './env'
import { ownerWallet } from './wallet'

export default async function drawJackpot() {
  await ownerWallet.writeContract({
    abi: eggsContractAbi,
    address: env.EGGS_CONTRACT_ADDRESS,
    functionName: 'drawJackpot',
  })
}
