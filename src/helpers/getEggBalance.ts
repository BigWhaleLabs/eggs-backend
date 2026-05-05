import { getContract } from 'viem'
import eggsContractAbi from './eggsContractAbi'
import env from './env'
import { publicClient } from './wallet'

export default async function getEggBalance(ethAddress: `0x${string}`) {
  const { totalBalance } = await getEggBalances(ethAddress)
  return totalBalance
}

export async function getEggBalances(ethAddress: `0x${string}`) {
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

    return {
      stakedBalance: staked,
      totalBalance: balance + staked,
      walletBalance: balance,
    }
  } catch (error) {
    console.error('Error fetching token balance:', error)
    return {
      stakedBalance: 0n,
      totalBalance: 0n,
      walletBalance: 0n,
    }
  }
}
