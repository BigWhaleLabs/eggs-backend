import { getContract } from 'viem'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import { publicClient } from './wallet'

export default async function getEggBalance(ethAddress: `0x${string}`) {
  try {
    const eggContract = getContract({
      address: env.EGGS_CONTRACT_ADDRESS,
      abi: eggsContractAbi,
      client: publicClient,
    })

    // Get both wallet balance and staked amount
    const [balance, staked] = await Promise.all([
      eggContract.read.balanceOf([ethAddress]),
      eggContract.read.stakeOf([ethAddress]),
    ])

    return balance + staked
  } catch (error) {
    console.error('Error fetching token balance:', error)
    return BigInt(0)
  }
}
